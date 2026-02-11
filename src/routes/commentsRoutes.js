import express from 'express';
import { auth } from '../middleware/auth.js';
import db from '../config/database.js';

const router = express.Router();

// Like/Unlike a comment
router.post('/:commentId/like', auth, async (req, res) => {
  try {
    const { commentId } = req.params;
    const userId = req.user.id;

    // Check if already liked
    const existingLike = await db.query(
      'SELECT id FROM comment_likes WHERE comment_id = $1 AND user_id = $2',
      [commentId, userId]
    );

    if (existingLike.rows.length > 0) {
      // Unlike - remove the like
      await db.query(
        'DELETE FROM comment_likes WHERE comment_id = $1 AND user_id = $2',
        [commentId, userId]
      );
      
      // Decrement likes count
      await db.query(
        'UPDATE comments SET likes_count = GREATEST(COALESCE(likes_count, 1) - 1, 0) WHERE id = $1',
        [commentId]
      );

      res.json({
        success: true,
        message: 'Comment unliked',
        data: { liked: false }
      });
    } else {
      // Like - add the like
      await db.query(
        'INSERT INTO comment_likes (comment_id, user_id) VALUES ($1, $2)',
        [commentId, userId]
      );
      
      // Increment likes count
      await db.query(
        'UPDATE comments SET likes_count = COALESCE(likes_count, 0) + 1 WHERE id = $1',
        [commentId]
      );

      res.json({
        success: true,
        message: 'Comment liked',
        data: { liked: true }
      });
    }
  } catch (error) {
    console.error('Like comment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to like comment'
    });
  }
});

// Add a reply to a comment
router.post('/:commentId/reply', auth, async (req, res) => {
  try {
    const { commentId } = req.params;
    const { replyText } = req.body;
    const userId = req.user.id;

    if (!replyText || !replyText.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Reply text is required'
      });
    }

    // Insert reply
    const result = await db.query(
      `INSERT INTO comment_replies (comment_id, user_id, reply_text)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [commentId, userId, replyText.trim()]
    );

    // Increment replies count
    await db.query(
      'UPDATE comments SET replies_count = COALESCE(replies_count, 0) + 1 WHERE id = $1',
      [commentId]
    );

    res.status(201).json({
      success: true,
      message: 'Reply posted',
      data: { reply: result.rows[0] }
    });
  } catch (error) {
    console.error('Add reply error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to post reply'
    });
  }
});

// Get replies for a comment
router.get('/:commentId/replies', auth, async (req, res) => {
  try {
    const { commentId } = req.params;

    const result = await db.query(
      `SELECT cr.*, u.first_name, u.last_name, u.country
       FROM comment_replies cr
       JOIN users u ON cr.user_id = u.id
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
    res.status(500).json({
      success: false,
      message: 'Failed to get replies'
    });
  }
});

// Delete a reply
router.delete('/replies/:replyId', auth, async (req, res) => {
  try {
    const { replyId } = req.params;
    const userId = req.user.id;

    // Get reply to check ownership and get comment_id
    const replyResult = await db.query(
      'SELECT * FROM comment_replies WHERE id = $1',
      [replyId]
    );

    if (replyResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Reply not found'
      });
    }

    const reply = replyResult.rows[0];

    // Check if user owns the reply
    if (reply.user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own replies'
      });
    }

    const commentId = reply.comment_id;

    // Delete the reply
    await db.query('DELETE FROM comment_replies WHERE id = $1', [replyId]);

    // Decrement replies count
    await db.query(
      'UPDATE comments SET replies_count = GREATEST(COALESCE(replies_count, 1) - 1, 0) WHERE id = $1',
      [commentId]
    );

    res.json({
      success: true,
      message: 'Reply deleted'
    });
  } catch (error) {
    console.error('Delete reply error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete reply'
    });
  }
});

export default router;
