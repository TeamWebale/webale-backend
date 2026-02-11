import pool from '../config/database.js';
import { logActivity, ACTIVITY_TYPES } from '../utils/activityLogger.js';

export const likeComment = async (req, res) => {
  try {
    const { commentId } = req.params;
    const userId = req.user.id;

    // Check if already liked
    const existingLike = await pool.query(
      'SELECT * FROM comment_likes WHERE comment_id = $1 AND user_id = $2',
      [commentId, userId]
    );

    if (existingLike.rows.length > 0) {
      // Unlike
      await pool.query(
        'DELETE FROM comment_likes WHERE comment_id = $1 AND user_id = $2',
        [commentId, userId]
      );
      await pool.query(
        'UPDATE comments SET likes_count = likes_count - 1 WHERE id = $1',
        [commentId]
      );
      return res.json({ success: true, action: 'unliked' });
    } else {
      // Like
      await pool.query(
        'INSERT INTO comment_likes (comment_id, user_id) VALUES ($1, $2)',
        [commentId, userId]
      );
      await pool.query(
        'UPDATE comments SET likes_count = likes_count + 1 WHERE id = $1',
        [commentId]
      );
      return res.json({ success: true, action: 'liked' });
    }
  } catch (error) {
    console.error('Like comment error:', error);
    res.status(500).json({ success: false, message: 'Error processing like' });
  }
};

export const replyToComment = async (req, res) => {
  try {
    const { commentId } = req.params;
    const { replyText } = req.body;
    const userId = req.user.id;

    if (!replyText || !replyText.trim()) {
      return res.status(400).json({ success: false, message: 'Reply text is required' });
    }

    // Get comment and group info
    const commentInfo = await pool.query(
      'SELECT group_id FROM comments WHERE id = $1',
      [commentId]
    );

    if (commentInfo.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Comment not found' });
    }

    const groupId = commentInfo.rows[0].group_id;

    // Insert reply
    const result = await pool.query(
      `INSERT INTO comment_replies (comment_id, user_id, group_id, reply_text)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [commentId, userId, groupId, replyText.trim()]
    );

    // Update replies count
    await pool.query(
      'UPDATE comments SET replies_count = replies_count + 1 WHERE id = $1',
      [commentId]
    );

    res.json({
      success: true,
      data: { reply: result.rows[0] },
      message: 'Reply added successfully'
    });
  } catch (error) {
    console.error('Reply to comment error:', error);
    res.status(500).json({ success: false, message: 'Error adding reply' });
  }
};

export const getCommentReplies = async (req, res) => {
  try {
    const { commentId } = req.params;

    const result = await pool.query(
      `SELECT 
        cr.*,
        u.first_name,
        u.last_name,
        u.country
       FROM comment_replies cr
       INNER JOIN users u ON cr.user_id = u.id
       WHERE cr.comment_id = $1
       ORDER BY cr.created_at ASC`,
      [commentId]
    );

    res.json({
      success: true,
      data: { replies: result.rows }
    });
  } catch (error) {
    console.error('Get replies error:', error);
    res.status(500).json({ success: false, message: 'Error fetching replies' });
  }
};

export const deleteReply = async (req, res) => {
  try {
    const { replyId } = req.params;
    const userId = req.user.id;

    // Check if user owns the reply or is admin
    const replyInfo = await pool.query(
      `SELECT cr.*, gm.role 
       FROM comment_replies cr
       LEFT JOIN group_members gm ON cr.group_id = gm.group_id AND gm.user_id = $1
       WHERE cr.id = $2`,
      [userId, replyId]
    );

    if (replyInfo.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Reply not found' });
    }

    const reply = replyInfo.rows[0];
    if (reply.user_id !== userId && reply.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this reply' });
    }

    // Delete reply
    await pool.query('DELETE FROM comment_replies WHERE id = $1', [replyId]);

    // Update replies count
    await pool.query(
      'UPDATE comments SET replies_count = GREATEST(0, replies_count - 1) WHERE id = $1',
      [reply.comment_id]
    );

    res.json({ success: true, message: 'Reply deleted successfully' });
  } catch (error) {
    console.error('Delete reply error:', error);
    res.status(500).json({ success: false, message: 'Error deleting reply' });
  }
};