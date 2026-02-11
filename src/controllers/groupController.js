import db from '../config/database.js';
import { v4 as uuidv4 } from 'uuid';

// Create a new group
export const createGroup = async (req, res) => {
  try {
    const { name, description, goalAmount, deadline, currency, category, isPublic, templateType } = req.body;
    const userId = req.user.id;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Group name is required'
      });
    }

    // Insert the group
    const result = await db.query(
      `INSERT INTO groups (name, description, goal_amount, deadline, currency, category, is_public, template_type, created_by, created_at, current_amount, pledged_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), 0, 0)
       RETURNING *`,
      [name, description || null, goalAmount || 0, deadline || null, currency || 'USD', category || null, isPublic !== false, templateType || null, userId]
    );

    const group = result.rows[0];

    // Add creator as admin member
    await db.query(
      `INSERT INTO group_members (group_id, user_id, role, joined_at)
       VALUES ($1, $2, 'admin', NOW())`,
      [group.id, userId]
    );

    // Log activity
    await db.query(
      `INSERT INTO activities (group_id, user_id, activity_type, activity_data, created_at)
       VALUES ($1, $2, 'group_created', $3, NOW())`,
      [group.id, userId, JSON.stringify({ groupName: name })]
    );

    res.status(201).json({
      success: true,
      message: 'Group created successfully',
      data: { group }
    });
  } catch (error) {
    console.error('Create group error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create group'
    });
  }
};

// Get all groups for current user
export const getAllGroups = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await db.query(
      `SELECT g.*, gm.role as user_role,
              (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count
       FROM groups g
       JOIN group_members gm ON g.id = gm.group_id
       WHERE gm.user_id = $1
       ORDER BY g.last_interaction DESC NULLS LAST, g.created_at DESC`,
      [userId]
    );

    res.json({
      success: true,
      data: { groups: result.rows }
    });
  } catch (error) {
    console.error('Get groups error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get groups'
    });
  }
};

// Get single group by ID
export const getGroupById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await db.query(
      `SELECT g.*, gm.role as user_role
       FROM groups g
       JOIN group_members gm ON g.id = gm.group_id
       WHERE g.id = $1 AND gm.user_id = $2`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Group not found or access denied'
      });
    }

    res.json({
      success: true,
      data: { group: result.rows[0] }
    });
  } catch (error) {
    console.error('Get group error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get group'
    });
  }
};

// Update group
export const updateGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, goalAmount, deadline } = req.body;
    const userId = req.user.id;

    // Check if user is admin
    const membership = await db.query(
      'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
      [id, userId]
    );

    if (membership.rows.length === 0 || membership.rows[0].role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can update the group'
      });
    }

    const result = await db.query(
      `UPDATE groups 
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           goal_amount = COALESCE($3, goal_amount),
           deadline = $4,
           updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [name, description, goalAmount, deadline || null, id]
    );

    res.json({
      success: true,
      message: 'Group updated successfully',
      data: { group: result.rows[0] }
    });
  } catch (error) {
    console.error('Update group error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update group'
    });
  }
};

// Delete group
export const deleteGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Check if user is admin
    const membership = await db.query(
      'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
      [id, userId]
    );

    if (membership.rows.length === 0 || membership.rows[0].role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can delete the group'
      });
    }

    // Delete related data
    await db.query('DELETE FROM activities WHERE group_id = $1', [id]);
    await db.query('DELETE FROM comments WHERE group_id = $1', [id]);
    await db.query('DELETE FROM pledges WHERE group_id = $1', [id]);
    await db.query('DELETE FROM invitations WHERE group_id = $1', [id]);
    await db.query('DELETE FROM group_members WHERE group_id = $1', [id]);
    await db.query('DELETE FROM groups WHERE id = $1', [id]);

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
};

// Get group members
export const getMembers = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.country, gm.role, gm.joined_at
       FROM group_members gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = $1
       ORDER BY gm.joined_at ASC`,
      [id]
    );

    res.json({
      success: true,
      data: { members: result.rows }
    });
  } catch (error) {
    console.error('Get members error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get members'
    });
  }
};

// Invite members
export const inviteMembers = async (req, res) => {
  try {
    const { id } = req.params;
    const { emails } = req.body;
    const userId = req.user.id;

    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email addresses'
      });
    }

    const invitations = [];

    for (const email of emails) {
      const token = uuidv4();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      await db.query(
        `INSERT INTO invitations (group_id, email, token, invited_by, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [id, email.trim(), token, userId, expiresAt]
      );

      invitations.push({
        email: email.trim(),
        token,
        inviteLink: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/invite/${token}`
      });
    }

    // Log activity
    await db.query(
      `INSERT INTO activities (group_id, user_id, activity_type, activity_data, created_at)
       VALUES ($1, $2, 'invitation_sent', $3, NOW())`,
      [id, userId, JSON.stringify({ count: emails.length })]
    );

    res.json({
      success: true,
      message: `${emails.length} invitation(s) created`,
      data: { invitations }
    });
  } catch (error) {
    console.error('Invite members error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create invitations'
    });
  }
};

// Get invitation preview (before joining)
export const getInvitationPreview = async (req, res) => {
  try {
    const { token } = req.params;

    const result = await db.query(
      `SELECT i.*, g.name as group_name, g.description as group_description, 
              g.goal_amount, g.currency, g.deadline,
              u.first_name as inviter_first_name, u.last_name as inviter_last_name
       FROM invitations i
       JOIN groups g ON i.group_id = g.id
       JOIN users u ON i.invited_by = u.id
       WHERE i.token = $1`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Invitation not found'
      });
    }

    const invitation = result.rows[0];

    // Check if expired
    if (new Date(invitation.expires_at) < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'This invitation has expired'
      });
    }

    // Check if already used
    if (invitation.status === 'accepted') {
      return res.status(400).json({
        success: false,
        message: 'This invitation has already been used'
      });
    }

    res.json({
      success: true,
      data: {
        invitation: {
          groupName: invitation.group_name,
          groupDescription: invitation.group_description,
          goalAmount: invitation.goal_amount,
          currency: invitation.currency,
          deadline: invitation.deadline,
          inviterName: `${invitation.inviter_first_name} ${invitation.inviter_last_name}`,
          expiresAt: invitation.expires_at
        }
      }
    });
  } catch (error) {
    console.error('Get invitation preview error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get invitation details'
    });
  }
};

// Join group via invitation
export const joinGroup = async (req, res) => {
  try {
    const { token } = req.params;
    const userId = req.user.id;

    const invResult = await db.query(
      'SELECT * FROM invitations WHERE token = $1',
      [token]
    );

    if (invResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Invitation not found'
      });
    }

    const invitation = invResult.rows[0];

    // Check if expired
    if (new Date(invitation.expires_at) < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'This invitation has expired'
      });
    }

    // Check if already a member
    const existingMembership = await db.query(
      'SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2',
      [invitation.group_id, userId]
    );

    if (existingMembership.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'You are already a member of this group'
      });
    }

    // Add user to group
    await db.query(
      `INSERT INTO group_members (group_id, user_id, role, joined_at)
       VALUES ($1, $2, 'member', NOW())`,
      [invitation.group_id, userId]
    );

    // Update invitation status
    await db.query(
      `UPDATE invitations SET status = 'accepted', accepted_at = NOW() WHERE id = $1`,
      [invitation.id]
    );

    // Log activity
    await db.query(
      `INSERT INTO activities (group_id, user_id, activity_type, activity_data, created_at)
       VALUES ($1, $2, 'member_joined', $3, NOW())`,
      [invitation.group_id, userId, JSON.stringify({ invitedBy: invitation.invited_by })]
    );

    // Update group last_interaction
    await db.query(
      'UPDATE groups SET last_interaction = NOW() WHERE id = $1',
      [invitation.group_id]
    );

    res.json({
      success: true,
      message: 'Successfully joined the group',
      data: { groupId: invitation.group_id }
    });
  } catch (error) {
    console.error('Join group error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to join group'
    });
  }
};

// Get group comments with like status
export const getComments = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // First try with comment_likes join
    try {
      const result = await db.query(
        `SELECT c.*, 
                u.first_name, 
                u.last_name, 
                u.country,
                COALESCE(c.likes_count, 0) as likes_count,
                COALESCE(c.replies_count, 0) as replies_count,
                CASE WHEN cl.id IS NOT NULL THEN true ELSE false END as liked_by_user
         FROM comments c
         JOIN users u ON c.user_id = u.id
         LEFT JOIN comment_likes cl ON c.id = cl.comment_id AND cl.user_id = $2
         WHERE c.group_id = $1
         ORDER BY c.created_at DESC`,
        [id, userId]
      );

      return res.json({
        success: true,
        data: { comments: result.rows }
      });
    } catch (e) {
      // If comment_likes table doesn't exist, query without it
      const result = await db.query(
        `SELECT c.*, 
                u.first_name, 
                u.last_name, 
                u.country,
                0 as likes_count,
                0 as replies_count,
                false as liked_by_user
         FROM comments c
         JOIN users u ON c.user_id = u.id
         WHERE c.group_id = $1
         ORDER BY c.created_at DESC`,
        [id]
      );

      return res.json({
        success: true,
        data: { comments: result.rows }
      });
    }
  } catch (error) {
    console.error('Get comments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get comments'
    });
  }
};

// Add comment
export const addComment = async (req, res) => {
  try {
    const { id } = req.params;
    const { commentText } = req.body;
    const userId = req.user.id;

    if (!commentText || !commentText.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Comment text is required'
      });
    }

    const result = await db.query(
      `INSERT INTO comments (group_id, user_id, comment_text, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING *`,
      [id, userId, commentText.trim()]
    );

    // Log activity
    await db.query(
      `INSERT INTO activities (group_id, user_id, activity_type, activity_data, created_at)
       VALUES ($1, $2, 'comment_posted', $3, NOW())`,
      [id, userId, JSON.stringify({ commentId: result.rows[0].id })]
    );

    // Update group last_interaction
    await db.query(
      'UPDATE groups SET last_interaction = NOW() WHERE id = $1',
      [id]
    );

    res.status(201).json({
      success: true,
      message: 'Comment added',
      data: { comment: result.rows[0] }
    });
  } catch (error) {
    console.error('Add comment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add comment'
    });
  }
};

// Delete comment (admin can delete any, users can delete own)
export const deleteComment = async (req, res) => {
  try {
    const { id, commentId } = req.params;
    const userId = req.user.id;

    // Check if user is admin
    const membership = await db.query(
      'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
      [id, userId]
    );

    // Get the comment
    const comment = await db.query(
      'SELECT user_id FROM comments WHERE id = $1 AND group_id = $2',
      [commentId, id]
    );

    if (comment.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Comment not found'
      });
    }

    const isAdmin = membership.rows[0]?.role === 'admin';
    const isOwner = comment.rows[0].user_id === userId;

    if (!isAdmin && !isOwner) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own comments'
      });
    }

    // Delete related likes (if table exists)
    try {
      await db.query('DELETE FROM comment_likes WHERE comment_id = $1', [commentId]);
    } catch (e) { /* table might not exist yet */ }
    
    // Delete related replies (if table exists)
    try {
      await db.query('DELETE FROM comment_replies WHERE comment_id = $1', [commentId]);
    } catch (e) { /* table might not exist yet */ }
    
    // Delete the comment
    await db.query('DELETE FROM comments WHERE id = $1', [commentId]);

    res.json({
      success: true,
      message: 'Comment deleted'
    });
  } catch (error) {
    console.error('Delete comment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete comment'
    });
  }
};

// Toggle comments on/off for group
export const toggleComments = async (req, res) => {
  try {
    const { id } = req.params;
    const { enabled } = req.body;
    const userId = req.user.id;

    // Check if user is admin
    const membership = await db.query(
      'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
      [id, userId]
    );

    if (membership.rows.length === 0 || membership.rows[0].role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can toggle comments'
      });
    }

    await db.query(
      'UPDATE groups SET comments_enabled = $1 WHERE id = $2',
      [enabled, id]
    );

    res.json({
      success: true,
      message: `Comments ${enabled ? 'enabled' : 'disabled'}`
    });
  } catch (error) {
    console.error('Toggle comments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to toggle comments'
    });
  }
};

// Get invitation stats
export const getInvitationStats = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      `SELECT 
         COUNT(*) as total,
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
         SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) as accepted,
         SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) as expired
       FROM invitations
       WHERE group_id = $1`,
      [id]
    );

    res.json({
      success: true,
      data: { stats: result.rows[0] }
    });
  } catch (error) {
    console.error('Get invitation stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get invitation stats'
    });
  }
};

// Block a user from the group (admin only)
export const blockUser = async (req, res) => {
  try {
    const { groupId, userId } = req.params;
    const { reason } = req.body;
    const adminId = req.user.id;

    // Check if requester is admin
    const membership = await db.query(
      'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, adminId]
    );

    if (membership.rows.length === 0 || membership.rows[0].role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can block users'
      });
    }

    // Can't block yourself
    if (parseInt(userId) === adminId) {
      return res.status(400).json({
        success: false,
        message: 'You cannot block yourself'
      });
    }

    // Check if user is in the group
    const targetMembership = await db.query(
      'SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, userId]
    );

    if (targetMembership.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User is not a member of this group'
      });
    }

    // Remove user from group
    await db.query(
      'DELETE FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, userId]
    );

    // Add to blocked list (create table if needed, or just log)
    try {
      await db.query(
        `INSERT INTO blocked_users (group_id, user_id, blocked_by, reason, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [groupId, userId, adminId, reason || null]
      );
    } catch (e) {
      // Table might not exist, that's okay - user is still removed
      console.log('Note: blocked_users table may not exist');
    }

    res.json({
      success: true,
      message: 'User blocked and removed from group'
    });
  } catch (error) {
    console.error('Block user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to block user'
    });
  }
};

// Remove a member from the group (admin only)
export const removeMember = async (req, res) => {
  try {
    const { groupId, userId } = req.params;
    const adminId = req.user.id;

    // Check if requester is admin
    const membership = await db.query(
      'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, adminId]
    );

    if (membership.rows.length === 0 || membership.rows[0].role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can remove members'
      });
    }

    // Can't remove yourself
    if (parseInt(userId) === adminId) {
      return res.status(400).json({
        success: false,
        message: 'You cannot remove yourself. Transfer admin rights first.'
      });
    }

    // Check if user is in the group
    const targetMembership = await db.query(
      'SELECT id, role FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, userId]
    );

    if (targetMembership.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User is not a member of this group'
      });
    }

    // Remove user from group
    await db.query(
      'DELETE FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, userId]
    );

    res.json({
      success: true,
      message: 'Member removed from group'
    });
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove member'
    });
  }
};
