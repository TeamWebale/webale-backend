import express from 'express';
import { auth } from '../middleware/auth.js';
import db from '../config/database.js';

const router = express.Router();

// Get all recurring pledges for a group (user's own)
router.get('/group/:groupId', auth, async (req, res) => {
  try {
    const { groupId } = req.params;

    const result = await db.query(
      `SELECT rp.*, 
              u.first_name, u.last_name, u.email
       FROM recurring_pledges rp
       JOIN users u ON rp.user_id = u.id
       WHERE rp.group_id = $1 AND rp.user_id = $2
       ORDER BY rp.created_at DESC`,
      [groupId, req.user.id]
    );

    res.json({
      success: true,
      data: { pledges: result.rows }
    });
  } catch (error) {
    console.error('Get recurring pledges error:', error);
    res.status(500).json({ success: false, message: 'Failed to get recurring pledges' });
  }
});

// Get user's recurring pledges for a group
router.get('/group/:groupId/my', auth, async (req, res) => {
  try {
    const { groupId } = req.params;

    const result = await db.query(
      `SELECT * FROM recurring_pledges 
       WHERE group_id = $1 AND user_id = $2
       ORDER BY created_at DESC`,
      [groupId, req.user.id]
    );

    res.json({
      success: true,
      data: { pledges: result.rows }
    });
  } catch (error) {
    console.error('Get my recurring pledges error:', error);
    res.status(500).json({ success: false, message: 'Failed to get recurring pledges' });
  }
});

// Create recurring pledge
router.post('/group/:groupId', auth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { amount, currency = 'USD', frequency, startDate, endDate, notes } = req.body;

    // Validate
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Valid amount is required' });
    }
    if (!['weekly', 'biweekly', 'monthly', 'quarterly'].includes(frequency)) {
      return res.status(400).json({ success: false, message: 'Invalid frequency' });
    }

    // Calculate next due date
    const nextDueDate = new Date(startDate);

    const result = await db.query(
      `INSERT INTO recurring_pledges 
       (group_id, user_id, amount, currency, frequency, start_date, end_date, next_due_date, notes, is_active, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, NOW())
       RETURNING *`,
      [groupId, req.user.id, amount, currency, frequency, startDate, endDate || null, nextDueDate, notes || null]
    );

    res.status(201).json({
      success: true,
      data: { pledge: result.rows[0] }
    });
  } catch (error) {
    console.error('Create recurring pledge error:', error);
    res.status(500).json({ success: false, message: 'Failed to create recurring pledge' });
  }
});

// Update recurring pledge
router.put('/group/:groupId/:pledgeId', auth, async (req, res) => {
  try {
    const { groupId, pledgeId } = req.params;
    const { amount, frequency, endDate, notes } = req.body;

    // Verify ownership
    const check = await db.query(
      'SELECT * FROM recurring_pledges WHERE id = $1 AND group_id = $2 AND user_id = $3',
      [pledgeId, groupId, req.user.id]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Recurring pledge not found' });
    }

    const result = await db.query(
      `UPDATE recurring_pledges 
       SET amount = COALESCE($1, amount),
           frequency = COALESCE($2, frequency),
           end_date = $3,
           notes = COALESCE($4, notes),
           updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [amount, frequency, endDate, notes, pledgeId]
    );

    res.json({
      success: true,
      data: { pledge: result.rows[0] }
    });
  } catch (error) {
    console.error('Update recurring pledge error:', error);
    res.status(500).json({ success: false, message: 'Failed to update recurring pledge' });
  }
});

// Cancel recurring pledge
router.put('/group/:groupId/:pledgeId/cancel', auth, async (req, res) => {
  try {
    const { groupId, pledgeId } = req.params;

    const result = await db.query(
      `UPDATE recurring_pledges 
       SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND group_id = $2 AND user_id = $3
       RETURNING *`,
      [pledgeId, groupId, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Recurring pledge not found' });
    }

    res.json({
      success: true,
      data: { pledge: result.rows[0] }
    });
  } catch (error) {
    console.error('Cancel recurring pledge error:', error);
    res.status(500).json({ success: false, message: 'Failed to cancel recurring pledge' });
  }
});

// Pause recurring pledge
router.put('/group/:groupId/:pledgeId/pause', auth, async (req, res) => {
  try {
    const { groupId, pledgeId } = req.params;

    const result = await db.query(
      `UPDATE recurring_pledges 
       SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND group_id = $2 AND user_id = $3
       RETURNING *`,
      [pledgeId, groupId, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Recurring pledge not found' });
    }

    res.json({ success: true, data: { pledge: result.rows[0] } });
  } catch (error) {
    console.error('Pause recurring pledge error:', error);
    res.status(500).json({ success: false, message: 'Failed to pause recurring pledge' });
  }
});

// Resume recurring pledge
router.put('/group/:groupId/:pledgeId/resume', auth, async (req, res) => {
  try {
    const { groupId, pledgeId } = req.params;

    const result = await db.query(
      `UPDATE recurring_pledges 
       SET is_active = true, updated_at = NOW()
       WHERE id = $1 AND group_id = $2 AND user_id = $3
       RETURNING *`,
      [pledgeId, groupId, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Recurring pledge not found' });
    }

    res.json({ success: true, data: { pledge: result.rows[0] } });
  } catch (error) {
    console.error('Resume recurring pledge error:', error);
    res.status(500).json({ success: false, message: 'Failed to resume recurring pledge' });
  }
});

export default router;
