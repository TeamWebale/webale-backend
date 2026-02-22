/**
 * messagesRoutes.js
 * Destination: src/routes/messagesRoutes.js  (backend)
 *
 * Endpoints:
 *   GET  /api/messages/groups          — groups the user belongs to + unread count
 *   GET  /api/messages/:groupId        — all messages in a group (conversations list)
 *   GET  /api/messages/:groupId/:userId — thread between current user and another user
 *   POST /api/messages                 — send a message to a group
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

// ── GET /api/messages/groups ─────────────────────────────────────
// Returns all groups the user is a member of, with latest message
// preview and unread_count for the NotificationBell.
router.get('/groups', auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(`
      SELECT
        g.id,
        g.name,
        g.currency,
        -- latest message in this group
        lm.content        AS last_message,
        lm.created_at     AS last_message_at,
        lm.sender_name,
        -- unread: messages after the user's last read time
        COALESCE(unread.cnt, 0)::int AS unread_count
      FROM groups g
      INNER JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $1

      -- latest message subquery
      LEFT JOIN LATERAL (
        SELECT
          m.content,
          m.created_at,
          CONCAT(u.first_name, ' ', u.last_name) AS sender_name
        FROM messages m
        JOIN users u ON u.id = m.user_id
        WHERE m.group_id = g.id
        ORDER BY m.created_at DESC
        LIMIT 1
      ) lm ON true

      -- unread count: messages not sent by this user, newer than 24h ago
      -- (simple heuristic — replace with a read_receipts table later)
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS cnt
        FROM messages m
        WHERE m.group_id = g.id
          AND m.user_id  != $1
          AND m.created_at > NOW() - INTERVAL '24 hours'
      ) unread ON true

      ORDER BY lm.created_at DESC NULLS LAST, g.name ASC
    `, [userId]);

    res.json({ data: result.rows });
  } catch (err) {
    console.error('GET /messages/groups error:', err);
    res.status(500).json({ message: 'Failed to fetch message groups' });
  }
});

// ── GET /api/messages/:groupId ────────────────────────────────────
// Returns all messages in a group, newest first, with sender info.
// NotificationBell uses this to show the "conversations" level.
router.get('/:groupId', auth, async (req, res) => {
  try {
    const userId  = req.user.id;
    const groupId = req.params.groupId;

    // Verify user is a member
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
        CONCAT(u.first_name, ' ', u.last_name) AS sender_name,
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
    console.error('GET /messages/:groupId error:', err);
    res.status(500).json({ message: 'Failed to fetch messages' });
  }
});

// ── GET /api/messages/:groupId/:userId ────────────────────────────
// Returns message thread between current user and another user
// within a specific group context.
router.get('/:groupId/:userId', auth, async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const { groupId, userId: otherUserId } = req.params;

    const result = await pool.query(`
      SELECT
        m.id,
        m.group_id,
        m.user_id,
        m.content,
        m.created_at,
        u.first_name,
        u.last_name,
        CONCAT(u.first_name, ' ', u.last_name) AS sender_name,
        u.avatar_url,
        u.avatar_type
      FROM messages m
      JOIN users u ON u.id = m.user_id
      WHERE m.group_id = $1
        AND (
          (m.user_id = $2 AND m.recipient_id = $3) OR
          (m.user_id = $3 AND m.recipient_id = $2) OR
          -- fallback: show all group messages if recipient_id column doesn't exist
          (m.recipient_id IS NULL)
        )
      ORDER BY m.created_at ASC
      LIMIT 200
    `, [groupId, currentUserId, otherUserId]);

    res.json({ data: result.rows });
  } catch (err) {
    // Graceful fallback if recipient_id column doesn't exist yet
    try {
      const currentUserId = req.user.id;
      const { groupId } = req.params;
      const fallback = await pool.query(`
        SELECT m.id, m.group_id, m.user_id, m.content, m.created_at,
               u.first_name, u.last_name,
               CONCAT(u.first_name, ' ', u.last_name) AS sender_name,
               u.avatar_url, u.avatar_type
        FROM messages m
        JOIN users u ON u.id = m.user_id
        WHERE m.group_id = $1
        ORDER BY m.created_at ASC LIMIT 200
      `, [groupId]);
      res.json({ data: fallback.rows });
    } catch (err2) {
      console.error('GET /messages/:groupId/:userId error:', err2);
      res.status(500).json({ message: 'Failed to fetch thread' });
    }
  }
});

// ── POST /api/messages ────────────────────────────────────────────
// Send a message to a group.
router.post('/', auth, async (req, res) => {
  try {
    const userId               = req.user.id;
    const { group_id, content, recipient_id } = req.body;

    if (!group_id || !content?.trim()) {
      return res.status(400).json({ message: 'group_id and content are required' });
    }

    // Verify user is a member
    const memberCheck = await pool.query(
      'SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2',
      [group_id, userId]
    );
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ message: 'Not a member of this group' });
    }

    // Insert — try with recipient_id, fall back without
    let result;
    try {
      result = await pool.query(
        `INSERT INTO messages (group_id, user_id, recipient_id, content, created_at)
         VALUES ($1, $2, $3, $4, NOW())
         RETURNING id, group_id, user_id, content, created_at`,
        [group_id, userId, recipient_id || null, content.trim()]
      );
    } catch {
      result = await pool.query(
        `INSERT INTO messages (group_id, user_id, content, created_at)
         VALUES ($1, $2, $3, NOW())
         RETURNING id, group_id, user_id, content, created_at`,
        [group_id, userId, content.trim()]
      );
    }

    res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    console.error('POST /messages error:', err);
    res.status(500).json({ message: 'Failed to send message' });
  }
});

export default router;
