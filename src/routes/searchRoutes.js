import express from 'express';
import { auth } from '../middleware/auth.js';
import db from '../config/database.js';

const router = express.Router();

// Search within a group (members, pledges, etc.)
router.get('/group/:groupId', auth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { q } = req.query;

    if (!q || q.length < 2) {
      return res.json({
        success: true,
        data: { members: [], pledges: [] }
      });
    }

    const searchTerm = `%${q.toLowerCase()}%`;

    // Search members
    const members = await db.query(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.country, gm.role
       FROM group_members gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = $1
         AND (LOWER(u.first_name) LIKE $2 
              OR LOWER(u.last_name) LIKE $2 
              OR LOWER(u.email) LIKE $2)
       LIMIT 10`,
      [groupId, searchTerm]
    );

    // Search pledges
    const pledges = await db.query(
      `SELECT p.*, u.first_name, u.last_name
       FROM pledges p
       LEFT JOIN users u ON p.user_id = u.id
       WHERE p.group_id = $1
         AND (LOWER(u.first_name) LIKE $2 
              OR LOWER(u.last_name) LIKE $2
              OR LOWER(p.notes) LIKE $2
              OR CAST(p.amount AS TEXT) LIKE $2)
       LIMIT 10`,
      [groupId, searchTerm]
    );

    res.json({
      success: true,
      data: {
        members: members.rows,
        pledges: pledges.rows,
        query: q
      }
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ success: false, message: 'Search failed' });
  }
});

// Search members only
router.get('/group/:groupId/members', auth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { q } = req.query;

    if (!q || q.length < 2) {
      return res.json({ success: true, data: { members: [] } });
    }

    const searchTerm = `%${q.toLowerCase()}%`;

    const result = await db.query(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.country, gm.role, gm.joined_at
       FROM group_members gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = $1
         AND (LOWER(u.first_name) LIKE $2 
              OR LOWER(u.last_name) LIKE $2 
              OR LOWER(u.email) LIKE $2)
       ORDER BY u.first_name
       LIMIT 20`,
      [groupId, searchTerm]
    );

    res.json({
      success: true,
      data: { members: result.rows }
    });
  } catch (error) {
    console.error('Search members error:', error);
    res.status(500).json({ success: false, message: 'Search failed' });
  }
});

// Search pledges only
router.get('/group/:groupId/pledges', auth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { q } = req.query;

    if (!q || q.length < 2) {
      return res.json({ success: true, data: { pledges: [] } });
    }

    const searchTerm = `%${q.toLowerCase()}%`;

    const result = await db.query(
      `SELECT p.*, u.first_name, u.last_name, u.email
       FROM pledges p
       LEFT JOIN users u ON p.user_id = u.id
       WHERE p.group_id = $1
         AND (LOWER(u.first_name) LIKE $2 
              OR LOWER(u.last_name) LIKE $2
              OR LOWER(u.email) LIKE $2
              OR LOWER(p.notes) LIKE $2
              OR CAST(p.amount AS TEXT) LIKE $2)
       ORDER BY p.created_at DESC
       LIMIT 20`,
      [groupId, searchTerm]
    );

    res.json({
      success: true,
      data: { pledges: result.rows }
    });
  } catch (error) {
    console.error('Search pledges error:', error);
    res.status(500).json({ success: false, message: 'Search failed' });
  }
});

// Global search (across user's groups)
router.get('/', auth, async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.length < 2) {
      return res.json({ success: true, data: { groups: [], members: [] } });
    }

    const searchTerm = `%${q.toLowerCase()}%`;

    // Search groups user is a member of
    const groups = await db.query(
      `SELECT g.id, g.name, g.description, gm.role
       FROM groups g
       JOIN group_members gm ON g.id = gm.group_id
       WHERE gm.user_id = $1
         AND (LOWER(g.name) LIKE $2 OR LOWER(g.description) LIKE $2)
       LIMIT 10`,
      [req.user.id, searchTerm]
    );

    res.json({
      success: true,
      data: {
        groups: groups.rows,
        query: q
      }
    });
  } catch (error) {
    console.error('Global search error:', error);
    res.status(500).json({ success: false, message: 'Search failed' });
  }
});

export default router;
