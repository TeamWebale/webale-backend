/**
 * messagesRoutes.js
 * Destination: src/routes/messagesRoutes.js  (backend)
 */

import express from 'express';
import pkg from 'pg';
const { Pool } = pkg;
import { auth } from '../middleware/auth.js';

const router = express.Router();
const pool   = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ── GET /api/messages/groups ──────────────────────────────────────
// Groups the user belongs to + latest message preview + unread count
router.get('/groups', auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(`
      SELECT
        g.id,
        g.name,
        g.currency,
        (
          SELECT m.content
          FROM messages m
          WHERE m.group_id = g.id
          ORDER BY m.created_at DESC
          LIMIT 1
        ) AS last_message,
        (
          SELECT m.created_at
          FROM messages m
          WHERE m.group_id = g.id
          ORDER BY m.created_at DESC
          LIMIT 1
        ) AS last_message_at,
        (
          SELECT COUNT(*)::int
          FROM messages m
          WHERE m.group_id = g.id
            AND m.user_id != $1
            AND m.created_at > NOW() - INTERVAL '24 hours'
        ) AS unread_count
      FROM groups g
      INNER JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $1
      ORDER BY last_message_at DESC NULLS LAST, g.name ASC
    `, [userId]);

    res.json({ data: result.rows });
  } catch (err) {
    console.error('GET /messages/groups error:', err.message);
    res.status(500).json({ message: 'Failed to fetch message groups', error: err.message });
  }
});

// ── GET /api/messages/:groupId ────────────────────────────────────
// All messages in a group with sender info
router.get('/:groupId', auth, async (req, res) => {
  try {
    const userId  = req.user.id;
    const groupId = req.params.groupId;

    const memberCheck = await pool.query(
      'SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, userId]
    );
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ message: 'Not a member of this group' });
    }

    const result = await pool.query(`
      SELECT
        m.id,
        m.group_id,
        m.user_id,
        m.content,
        m.created_at,
        u.first_name,
        u.last_name,
        u.avatar_url,
        u.avatar_type
      FROM messages m
      JOIN users u ON u.id = m.user_id
      WHERE m.group_id = $1
      ORDER BY m.created_at DESC
      LIMIT 100
    `, [groupId]);

    res.json({ data: result.rows });
  } catch (err) {
    console.error('GET /messages/:groupId error:', err.message);
    res.status(500).json({ message: 'Failed to fetch messages' });
  }
});

// ── GET /api/messages/:groupId/:userId ────────────────────────────
// All messages in a group (thread context)
router.get('/:groupId/:userId', auth, async (req, res) => {
  try {
    const { groupId } = req.params;

    const result = await pool.query(`
      SELECT
        m.id,
        m.group_id,
        m.user_id,
        m.content,
        m.created_at,
        u.first_name,
        u.last_name,
        u.avatar_url,
        u.avatar_type
      FROM messages m
      JOIN users u ON u.id = m.user_id
      WHERE m.group_id = $1
      ORDER BY m.created_at ASC
      LIMIT 200
    `, [groupId]);

    res.json({ data: result.rows });
  } catch (err) {
    console.error('GET /messages/:groupId/:userId error:', err.message);
    res.status(500).json({ message: 'Failed to fetch thread' });
  }
});

// ── POST /api/messages ────────────────────────────────────────────
// Send a message to a group
router.post('/', auth, async (req, res) => {
  try {
    const userId              = req.user.id;
    const { group_id, content } = req.body;

    if (!group_id || !content?.trim()) {
      return res.status(400).json({ message: 'group_id and content are required' });
    }

    const memberCheck = await pool.query(
      'SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2',
      [group_id, userId]
    );
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ message: 'Not a member of this group' });
    }

    const result = await pool.query(
      `INSERT INTO messages (group_id, user_id, content, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING id, group_id, user_id, content, created_at`,
      [group_id, userId, content.trim()]
    );

    res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    console.error('POST /messages error:', err.message);
    res.status(500).json({ message: 'Failed to send message' });
  }
});

export default router;
