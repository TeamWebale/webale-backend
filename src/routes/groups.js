import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/database.js';
import { auth } from '../middleware/auth.js';

const router = express.Router();

// Create a new group
router.post('/', auth, async (req, res) => {
  try {
    const { name, description, goalAmount, deadline, currency } = req.body;
    const userId = req.user.id;

    console.log('Creating group with data:', { name, description, goalAmount, deadline, currency, userId });

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Group name is required'
      });
    }

    const groupId = uuidv4();
    const now = new Date();

    // Insert the group
    await db.query(
      `INSERT INTO groups (id, name, description, goal_amount, current_amount, pledged_amount, deadline, currency, created_by, created_at, updated_at, comments_enabled)
       VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, true)`,
      [
        groupId,
        name.trim(),
        description || null,
        goalAmount || 0,
        deadline || null,
        currency || 'USD',
        userId,
        now,
        now
      ]
    );

    // Add the creator as admin member
    await db.query(
      `INSERT INTO group_members (id, group_id, user_id, role, joined_at)
       VALUES (?, ?, ?, 'admin', ?)`,
      [uuidv4(), groupId, userId, now]
    );

    // Log activity
    await db.query(
      `INSERT INTO activities (id, group_id, user_id, activity_type, activity_data, created_at)
       VALUES (?, ?, ?, 'group_created', ?, ?)`,
      [uuidv4(), groupId, userId, JSON.stringify({ groupName: name }), now]
    );

    // Fetch the created group
    const [groups] = await db.query(
      `SELECT g.*, 
              'admin' as user_role
       FROM groups g
       WHERE g.id = ?`,
      [groupId]
    );

    res.status(201).json({
      success: true,
      message: 'Group created successfully',
      data: {
        group: groups[0]
      }
    });
  } catch (error) {
    console.error('Create group error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create group',
      error: error.message
    });
  }
});

// Get all groups for current user
router.get('/', auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const [groups] = await db.query(
      `SELECT g.*, 
              gm.role as user_role,
              (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count
       FROM groups g
       JOIN group_members gm ON g.id = gm.group_id
       WHERE gm.user_id = ?
       ORDER BY g.updated_at DESC`,
      [userId]
    );

    res.json({
      success: true,
      data: {
        groups
      }
    });
  } catch (error) {
    console.error('Get groups error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch groups'
    });
  }
});

// Get single group by ID
router.get('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Check if user is a member
    const [membership] = await db.query(
      `SELECT role FROM group_members WHERE group_id = ? AND user_id = ?`,
      [id, userId]
    );

    if (membership.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'You are not a member of this group'
      });
    }

    const [groups] = await db.query(
      `SELECT g.*,
              ? as user_role
       FROM groups g
       WHERE g.id = ?`,
      [membership[0].role, id]
    );

    if (groups.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    res.json({
      success: true,
      data: {
        group: groups[0]
      }
    });
  } catch (error) {
    console.error('Get group error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch group'
    });
  }
});

// Get group members
router.get('/:id/members', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Check if user is a member
    const [membership] = await db.query(
      `SELECT role FROM group_members WHERE group_id = ? AND user_id = ?`,
      [id, userId]
    );

    if (membership.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'You are not a member of this group'
      });
    }

    const [members] = await db.query(
      `SELECT u.id, u.first_name, u.last_name, u.country, gm.role, gm.joined_at, gm.visibility_preference
       FROM group_members gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = ?
       ORDER BY gm.joined_at ASC`,
      [id]
    );

    res.json({
      success: true,
      data: {
        members
      }
    });
  } catch (error) {
    console.error('Get members error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch members'
    });
  }
});

// Update group
router.put('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { name, description, goalAmount, deadline } = req.body;

    // Check if user is admin
    const [membership] = await db.query(
      `SELECT role FROM group_members WHERE group_id = ? AND user_id = ?`,
      [id, userId]
    );

    if (membership.length === 0 || membership[0].role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can update group settings'
      });
    }

    await db.query(
      `UPDATE groups SET name = ?, description = ?, goal_amount = ?, deadline = ?, updated_at = ?
       WHERE id = ?`,
      [name, description, goalAmount, deadline, new Date(), id]
    );

    const [groups] = await db.query(`SELECT * FROM groups WHERE id = ?`, [id]);

    res.json({
      success: true,
      message: 'Group updated successfully',
      data: {
        group: groups[0]
      }
    });
  } catch (error) {
    console.error('Update group error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update group'
    });
  }
});

// Delete group
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Check if user is admin
    const [membership] = await db.query(
      `SELECT role FROM group_members WHERE group_id = ? AND user_id = ?`,
      [id, userId]
    );

    if (membership.length === 0 || membership[0].role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can delete a group'
      });
    }

    // Delete related records first
    await db.query(`DELETE FROM activities WHERE group_id = ?`, [id]);
    await db.query(`DELETE FROM comments WHERE group_id = ?`, [id]);
    await db.query(`DELETE FROM pledges WHERE group_id = ?`, [id]);
    await db.query(`DELETE FROM invitations WHERE group_id = ?`, [id]);
    await db.query(`DELETE FROM group_members WHERE group_id = ?`, [id]);
    await db.query(`DELETE FROM groups WHERE id = ?`, [id]);

    res.json({
      success: true,
      message: 'Group deleted successfully'
    });
  } catch (error) {
    console.error('Delete group error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete group'
    });
  }
});

// Get group comments
router.get('/:id/comments', auth, async (req, res) => {
  try {
    const { id } = req.params;

    const [comments] = await db.query(
      `SELECT c.*, u.first_name, u.last_name, u.country
       FROM comments c
       JOIN users u ON c.user_id = u.id
       WHERE c.group_id = ? AND c.parent_id IS NULL
       ORDER BY c.created_at DESC`,
      [id]
    );

    res.json({
      success: true,
      data: {
        comments
      }
    });
  } catch (error) {
    console.error('Get comments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch comments'
    });
  }
});

// Add comment
router.post('/:id/comments', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Comment text is required'
      });
    }

    const commentId = uuidv4();
    const now = new Date();

    await db.query(
      `INSERT INTO comments (id, group_id, user_id, comment_text, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [commentId, id, userId, text.trim(), now]
    );

    // Log activity
    await db.query(
      `INSERT INTO activities (id, group_id, user_id, activity_type, activity_data, created_at)
       VALUES (?, ?, ?, 'comment_posted', ?, ?)`,
      [uuidv4(), id, userId, JSON.stringify({ commentId }), now]
    );

    res.status(201).json({
      success: true,
      message: 'Comment added successfully'
    });
  } catch (error) {
    console.error('Add comment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add comment'
    });
  }
});

// Delete comment
router.delete('/:groupId/comments/:commentId', auth, async (req, res) => {
  try {
    const { groupId, commentId } = req.params;
    const userId = req.user.id;

    // Check if user is admin or comment owner
    const [membership] = await db.query(
      `SELECT role FROM group_members WHERE group_id = ? AND user_id = ?`,
      [groupId, userId]
    );

    const [comment] = await db.query(
      `SELECT user_id FROM comments WHERE id = ?`,
      [commentId]
    );

    if (membership[0]?.role !== 'admin' && comment[0]?.user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own comments'
      });
    }

    // Delete replies first
    await db.query(`DELETE FROM comments WHERE parent_id = ?`, [commentId]);
    await db.query(`DELETE FROM comments WHERE id = ?`, [commentId]);

    res.json({
      success: true,
      message: 'Comment deleted successfully'
    });
  } catch (error) {
    console.error('Delete comment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete comment'
    });
  }
});

// Toggle comments
router.put('/:id/toggle-comments', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { enabled } = req.body;

    // Check if user is admin
    const [membership] = await db.query(
      `SELECT role FROM group_members WHERE group_id = ? AND user_id = ?`,
      [id, userId]
    );

    if (membership.length === 0 || membership[0].role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can toggle comments'
      });
    }

    await db.query(
      `UPDATE groups SET comments_enabled = ? WHERE id = ?`,
      [enabled, id]
    );

    res.json({
      success: true,
      message: `Comments ${enabled ? 'enabled' : 'disabled'} successfully`
    });
  } catch (error) {
    console.error('Toggle comments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to toggle comments'
    });
  }
});

// Create invitation
router.post('/:id/invite', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { emails } = req.body;

    // Check if user is admin
    const [membership] = await db.query(
      `SELECT role FROM group_members WHERE group_id = ? AND user_id = ?`,
      [id, userId]
    );

    if (membership.length === 0 || membership[0].role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can send invitations'
      });
    }

    const invitations = [];
    const now = new Date();

    for (const email of emails) {
      const token = uuidv4();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      await db.query(
        `INSERT INTO invitations (id, group_id, email, token, invited_by, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [uuidv4(), id, email, token, userId, expiresAt, now]
      );

      invitations.push({
        email,
        token,
        inviteLink: `http://localhost:5173/invite/${token}`
      });
    }

    // Log activity
    await db.query(
      `INSERT INTO activities (id, group_id, user_id, activity_type, activity_data, created_at)
       VALUES (?, ?, ?, 'invitation_sent', ?, ?)`,
      [uuidv4(), id, userId, JSON.stringify({ count: emails.length }), now]
    );

    res.json({
      success: true,
      message: `${emails.length} invitation(s) created`,
      data: {
        invitations
      }
    });
  } catch (error) {
    console.error('Create invitation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create invitations'
    });
  }
});

// Get invitation stats
router.get('/:id/invitation-stats', auth, async (req, res) => {
  try {
    const { id } = req.params;

    const [invitations] = await db.query(
      `SELECT i.*, u.first_name as invited_by_name
       FROM invitations i
       LEFT JOIN users u ON i.invited_by = u.id
       WHERE i.group_id = ?
       ORDER BY i.created_at DESC`,
      [id]
    );

    res.json({
      success: true,
      data: {
        invitations
      }
    });
  } catch (error) {
    console.error('Get invitation stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch invitation stats'
    });
  }
});

export default router;
