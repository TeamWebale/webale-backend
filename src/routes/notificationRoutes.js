import express from 'express';
import { auth } from '../middleware/auth.js';
import db from '../config/database.js';

const router = express.Router();

// Get all notifications for current user
router.get('/', auth, async (req, res) => {
  try {
    const { limit = 50, offset = 0, unread_only = false } = req.query;

    let query = `
      SELECT 
        n.*,
        g.name as group_name
      FROM notifications n
      LEFT JOIN groups g ON n.group_id = g.id
      WHERE n.user_id = $1
    `;
    
    const params = [req.user.id];
    
    if (unread_only === 'true') {
      query += ' AND n.is_read = false';
    }
    
    query += ' ORDER BY n.created_at DESC LIMIT $2 OFFSET $3';
    params.push(parseInt(limit), parseInt(offset));

    const result = await db.query(query, params);

    // Get unread count
    const countResult = await db.query(
      'SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false',
      [req.user.id]
    );

    res.json({
      success: true,
      data: {
        notifications: result.rows,
        unreadCount: parseInt(countResult.rows[0].count)
      }
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ success: false, message: 'Failed to get notifications' });
  }
});

// Get unread count only
router.get('/unread-count', auth, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false',
      [req.user.id]
    );

    res.json({
      success: true,
      data: { count: parseInt(result.rows[0].count) }
    });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ success: false, message: 'Failed to get unread count' });
  }
});

// Mark single notification as read
router.put('/:notificationId/read', auth, async (req, res) => {
  try {
    const { notificationId } = req.params;

    const result = await db.query(
      `UPDATE notifications 
       SET is_read = true, read_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [notificationId, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    res.json({
      success: true,
      data: { notification: result.rows[0] }
    });
  } catch (error) {
    console.error('Mark as read error:', error);
    res.status(500).json({ success: false, message: 'Failed to mark as read' });
  }
});

// Mark all notifications as read
router.put('/read-all', auth, async (req, res) => {
  try {
    await db.query(
      `UPDATE notifications 
       SET is_read = true, read_at = NOW()
       WHERE user_id = $1 AND is_read = false`,
      [req.user.id]
    );

    res.json({
      success: true,
      message: 'All notifications marked as read'
    });
  } catch (error) {
    console.error('Mark all as read error:', error);
    res.status(500).json({ success: false, message: 'Failed to mark all as read' });
  }
});

// Delete a notification
router.delete('/:notificationId', auth, async (req, res) => {
  try {
    const { notificationId } = req.params;

    const result = await db.query(
      'DELETE FROM notifications WHERE id = $1 AND user_id = $2 RETURNING id',
      [notificationId, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    res.json({
      success: true,
      message: 'Notification deleted'
    });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete notification' });
  }
});

// Clear all notifications
router.delete('/', auth, async (req, res) => {
  try {
    await db.query(
      'DELETE FROM notifications WHERE user_id = $1',
      [req.user.id]
    );

    res.json({
      success: true,
      message: 'All notifications cleared'
    });
  } catch (error) {
    console.error('Clear notifications error:', error);
    res.status(500).json({ success: false, message: 'Failed to clear notifications' });
  }
});

// Helper function to create notifications (exported for use in other routes)
export const createNotification = async ({
  userId,
  type,
  title,
  message,
  groupId = null,
  relatedId = null,
  relatedType = null
}) => {
  try {
    const result = await db.query(
      `INSERT INTO notifications 
       (user_id, type, title, message, group_id, related_id, related_type, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING *`,
      [userId, type, title, message, groupId, relatedId, relatedType]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Create notification error:', error);
    return null;
  }
};

// Notify multiple users
export const notifyUsers = async (userIds, notificationData) => {
  for (const userId of userIds) {
    await createNotification({ ...notificationData, userId });
  }
};

// Notify all group members
export const notifyGroupMembers = async (groupId, notificationData, excludeUserId = null) => {
  try {
    const members = await db.query(
      'SELECT user_id FROM group_members WHERE group_id = $1',
      [groupId]
    );
    
    for (const member of members.rows) {
      if (excludeUserId && member.user_id === excludeUserId) continue;
      await createNotification({ ...notificationData, userId: member.user_id, groupId });
    }
  } catch (error) {
    console.error('Notify group members error:', error);
  }
};

export default router;
