import express from 'express';
import { auth } from '../middleware/auth.js';
import db from '../config/database.js';

const router = express.Router();

// Get all notices for a group
router.get('/group/:groupId', auth, async (req, res) => {
  try {
    const { groupId } = req.params;

    // Check if notices table exists, if not return empty array
    const tableCheck = await db.query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'notices'
      )`
    );

    if (!tableCheck.rows[0].exists) {
      return res.json({
        success: true,
        data: { notices: [] }
      });
    }

    const result = await db.query(
      `SELECT n.*, u.first_name, u.last_name
       FROM notices n
       JOIN users u ON n.created_by = u.id
       WHERE n.group_id = $1
       ORDER BY n.is_pinned DESC, n.created_at DESC`,
      [groupId]
    );

    res.json({
      success: true,
      data: { notices: result.rows }
    });
  } catch (error) {
    console.error('Get notices error:', error);
    res.status(500).json({ success: false, message: 'Failed to get notices' });
  }
});

// Create a notice
router.post('/group/:groupId', auth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { title, content, type = 'info' } = req.body;

    // Check if user is admin
    const memberCheck = await db.query(
      'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, req.user.id]
    );

    if (memberCheck.rows.length === 0 || memberCheck.rows[0].role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins can create notices' });
    }

    // Create notices table if it doesn't exist
    await db.query(`
      CREATE TABLE IF NOT EXISTS notices (
        id SERIAL PRIMARY KEY,
        group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        content TEXT,
        type VARCHAR(20) DEFAULT 'info',
        is_pinned BOOLEAN DEFAULT false,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP
      )
    `);

    const result = await db.query(
      `INSERT INTO notices (group_id, title, content, type, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING *`,
      [groupId, title, content, type, req.user.id]
    );

    res.status(201).json({
      success: true,
      data: { notice: result.rows[0] }
    });
  } catch (error) {
    console.error('Create notice error:', error);
    res.status(500).json({ success: false, message: 'Failed to create notice' });
  }
});

// Update a notice
router.put('/group/:groupId/:noticeId', auth, async (req, res) => {
  try {
    const { groupId, noticeId } = req.params;
    const { title, content, type } = req.body;

    const result = await db.query(
      `UPDATE notices 
       SET title = COALESCE($1, title),
           content = COALESCE($2, content),
           type = COALESCE($3, type),
           updated_at = NOW()
       WHERE id = $4 AND group_id = $5
       RETURNING *`,
      [title, content, type, noticeId, groupId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Notice not found' });
    }

    res.json({
      success: true,
      data: { notice: result.rows[0] }
    });
  } catch (error) {
    console.error('Update notice error:', error);
    res.status(500).json({ success: false, message: 'Failed to update notice' });
  }
});

// Delete a notice
router.delete('/group/:groupId/:noticeId', auth, async (req, res) => {
  try {
    const { groupId, noticeId } = req.params;

    const result = await db.query(
      'DELETE FROM notices WHERE id = $1 AND group_id = $2 RETURNING id',
      [noticeId, groupId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Notice not found' });
    }

    res.json({ success: true, message: 'Notice deleted' });
  } catch (error) {
    console.error('Delete notice error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete notice' });
  }
});

// Toggle pin status
router.put('/group/:groupId/:noticeId/pin', auth, async (req, res) => {
  try {
    const { groupId, noticeId } = req.params;

    const result = await db.query(
      `UPDATE notices 
       SET is_pinned = NOT is_pinned, updated_at = NOW()
       WHERE id = $1 AND group_id = $2
       RETURNING *`,
      [noticeId, groupId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Notice not found' });
    }

    res.json({
      success: true,
      data: { notice: result.rows[0] }
    });
  } catch (error) {
    console.error('Toggle pin error:', error);
    res.status(500).json({ success: false, message: 'Failed to toggle pin' });
  }
});

export default router;
