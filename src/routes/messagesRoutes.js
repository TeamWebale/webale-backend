import express from 'express';
import { auth } from '../middleware/auth.js';
import db from '../config/database.js';

const router = express.Router();

// Get all conversations for a user in a group
router.get('/group/:groupId/conversations', auth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.id;

    // Get all unique conversations (people user has messaged with)
    const result = await db.query(
      `WITH conversations AS (
        SELECT DISTINCT
          CASE 
            WHEN sender_id = $2 THEN recipient_id 
            ELSE sender_id 
          END as other_user_id,
          MAX(created_at) as last_message_at
        FROM messages
        WHERE group_id = $1 AND (sender_id = $2 OR recipient_id = $2)
        GROUP BY other_user_id
      )
      SELECT 
        c.other_user_id,
        c.last_message_at,
        u.first_name,
        u.last_name,
        u.country,
        u.avatar_url,
        u.avatar_type,
        u.last_active,
        (SELECT content FROM messages 
         WHERE group_id = $1 
           AND ((sender_id = $2 AND recipient_id = c.other_user_id) 
                OR (sender_id = c.other_user_id AND recipient_id = $2))
         ORDER BY created_at DESC LIMIT 1) as last_message,
        (SELECT COUNT(*) FROM messages 
         WHERE group_id = $1 
           AND sender_id = c.other_user_id 
           AND recipient_id = $2 
           AND is_read = false) as unread_count
      FROM conversations c
      JOIN users u ON c.other_user_id = u.id
      ORDER BY c.last_message_at DESC`,
      [groupId, userId]
    );

    res.json({
      success: true,
      data: { conversations: result.rows }
    });
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get conversations'
    });
  }
});

// Get messages between two users in a group
router.get('/group/:groupId/with/:recipientId', auth, async (req, res) => {
  try {
    const { groupId, recipientId } = req.params;
    const userId = req.user.id;

    const result = await db.query(
      `SELECT m.*, 
              sender.first_name as sender_first_name, 
              sender.last_name as sender_last_name,
              sender.avatar_url as sender_avatar_url,
              sender.avatar_type as sender_avatar_type
       FROM messages m
       JOIN users sender ON m.sender_id = sender.id
       WHERE m.group_id = $1 
         AND ((m.sender_id = $2 AND m.recipient_id = $3) 
              OR (m.sender_id = $3 AND m.recipient_id = $2))
       ORDER BY m.created_at ASC`,
      [groupId, userId, recipientId]
    );

    res.json({
      success: true,
      data: { messages: result.rows }
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get messages'
    });
  }
});

// Send a message
router.post('/group/:groupId/send', auth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { recipientId, content } = req.body;
    const senderId = req.user.id;

    if (!content || !content.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Message content is required'
      });
    }

    if (!recipientId) {
      return res.status(400).json({
        success: false,
        message: 'Recipient is required'
      });
    }

    // Verify both users are members of the group
    const memberCheck = await db.query(
      `SELECT user_id FROM group_members 
       WHERE group_id = $1 AND user_id IN ($2, $3)`,
      [groupId, senderId, recipientId]
    );

    if (memberCheck.rows.length < 2) {
      return res.status(403).json({
        success: false,
        message: 'Both users must be members of the group'
      });
    }

    // Insert message
    const result = await db.query(
      `INSERT INTO messages (group_id, sender_id, recipient_id, content, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING *`,
      [groupId, senderId, recipientId, content.trim()]
    );

    // Get sender info for response
    const senderInfo = await db.query(
      'SELECT first_name, last_name, avatar_url, avatar_type FROM users WHERE id = $1',
      [senderId]
    );

    const message = {
      ...result.rows[0],
      sender_first_name: senderInfo.rows[0].first_name,
      sender_last_name: senderInfo.rows[0].last_name,
      sender_avatar_url: senderInfo.rows[0].avatar_url,
      sender_avatar_type: senderInfo.rows[0].avatar_type
    };

    res.status(201).json({
      success: true,
      message: 'Message sent',
      data: { message }
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send message'
    });
  }
});

// Mark messages as read
router.put('/group/:groupId/read/:senderId', auth, async (req, res) => {
  try {
    const { groupId, senderId } = req.params;
    const recipientId = req.user.id;

    await db.query(
      `UPDATE messages 
       SET is_read = true, read_at = NOW()
       WHERE group_id = $1 
         AND sender_id = $2 
         AND recipient_id = $3 
         AND is_read = false`,
      [groupId, senderId, recipientId]
    );

    res.json({
      success: true,
      message: 'Messages marked as read'
    });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark messages as read'
    });
  }
});

// Get unread message count for user across all groups
router.get('/unread-count', auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await db.query(
      `SELECT COUNT(*) as total_unread,
              group_id,
              (SELECT name FROM groups WHERE id = messages.group_id) as group_name
       FROM messages
       WHERE recipient_id = $1 AND is_read = false
       GROUP BY group_id`,
      [userId]
    );

    const totalUnread = result.rows.reduce((sum, row) => sum + parseInt(row.total_unread), 0);

    res.json({
      success: true,
      data: { 
        totalUnread,
        byGroup: result.rows
      }
    });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get unread count'
    });
  }
});

// Delete a message (sender only)
router.delete('/:messageId', auth, async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;

    // Check if user is sender
    const message = await db.query(
      'SELECT sender_id FROM messages WHERE id = $1',
      [messageId]
    );

    if (message.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    if (message.rows[0].sender_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own messages'
      });
    }

    await db.query('DELETE FROM messages WHERE id = $1', [messageId]);

    res.json({
      success: true,
      message: 'Message deleted'
    });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete message'
    });
  }
});

export default router;
