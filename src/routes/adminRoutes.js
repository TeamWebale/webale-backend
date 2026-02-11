import express from 'express';
import { auth } from '../middleware/auth.js';
import db from '../config/database.js';

const router = express.Router();

// Helper: Check if user is admin of group
const isGroupAdmin = async (groupId, userId) => {
  const result = await db.query(
    'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
    [groupId, userId]
  );
  return result.rows.length > 0 && result.rows[0].role === 'admin';
};

// Helper: Check if user is primary admin (owner)
const isPrimaryAdmin = async (groupId, userId) => {
  const result = await db.query(
    'SELECT primary_admin_id FROM groups WHERE id = $1',
    [groupId]
  );
  return result.rows.length > 0 && result.rows[0].primary_admin_id === userId;
};

// Helper: Log admin action
const logAdminAction = async (groupId, adminId, actionType, targetUserId, details = {}) => {
  await db.query(
    `INSERT INTO admin_logs (group_id, admin_id, action_type, target_user_id, details, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [groupId, adminId, actionType, targetUserId, JSON.stringify(details)]
  );
};

// Promote member to admin
router.post('/:groupId/promote/:userId', auth, async (req, res) => {
  try {
    const { groupId, userId } = req.params;
    const adminId = req.user.id;

    if (!(await isGroupAdmin(groupId, adminId))) {
      return res.status(403).json({ success: false, message: 'Only admins can promote members' });
    }

    // Check target is a member
    const membership = await db.query(
      'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, userId]
    );

    if (membership.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User is not a member of this group' });
    }

    if (membership.rows[0].role === 'admin') {
      return res.status(400).json({ success: false, message: 'User is already an admin' });
    }

    // Promote to admin
    await db.query(
      'UPDATE group_members SET role = $1 WHERE group_id = $2 AND user_id = $3',
      ['admin', groupId, userId]
    );

    await logAdminAction(groupId, adminId, 'promote_admin', userId);

    res.json({ success: true, message: 'Member promoted to admin' });
  } catch (error) {
    console.error('Promote admin error:', error);
    res.status(500).json({ success: false, message: 'Failed to promote member' });
  }
});

// Demote admin to member
router.post('/:groupId/demote/:userId', auth, async (req, res) => {
  try {
    const { groupId, userId } = req.params;
    const adminId = req.user.id;

    // Only primary admin can demote other admins
    if (!(await isPrimaryAdmin(groupId, adminId))) {
      return res.status(403).json({ success: false, message: 'Only the group owner can demote admins' });
    }

    // Can't demote yourself
    if (parseInt(userId) === adminId) {
      return res.status(400).json({ success: false, message: 'You cannot demote yourself' });
    }

    // Check target is an admin
    const membership = await db.query(
      'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, userId]
    );

    if (membership.rows.length === 0 || membership.rows[0].role !== 'admin') {
      return res.status(400).json({ success: false, message: 'User is not an admin' });
    }

    // Demote to member
    await db.query(
      'UPDATE group_members SET role = $1 WHERE group_id = $2 AND user_id = $3',
      ['member', groupId, userId]
    );

    await logAdminAction(groupId, adminId, 'demote_admin', userId);

    res.json({ success: true, message: 'Admin demoted to member' });
  } catch (error) {
    console.error('Demote admin error:', error);
    res.status(500).json({ success: false, message: 'Failed to demote admin' });
  }
});

// Remove member from group
router.delete('/:groupId/member/:userId', auth, async (req, res) => {
  try {
    const { groupId, userId } = req.params;
    const adminId = req.user.id;

    if (!(await isGroupAdmin(groupId, adminId))) {
      return res.status(403).json({ success: false, message: 'Only admins can remove members' });
    }

    // Can't remove yourself
    if (parseInt(userId) === adminId) {
      return res.status(400).json({ success: false, message: 'You cannot remove yourself' });
    }

    // Can't remove primary admin
    if (await isPrimaryAdmin(groupId, parseInt(userId))) {
      return res.status(403).json({ success: false, message: 'Cannot remove the group owner' });
    }

    // Remove from group
    await db.query(
      'DELETE FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, userId]
    );

    await logAdminAction(groupId, adminId, 'remove_member', userId);

    res.json({ success: true, message: 'Member removed from group' });
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({ success: false, message: 'Failed to remove member' });
  }
});

// Block user
router.post('/:groupId/block/:userId', auth, async (req, res) => {
  try {
    const { groupId, userId } = req.params;
    const { reason } = req.body;
    const adminId = req.user.id;

    if (!(await isGroupAdmin(groupId, adminId))) {
      return res.status(403).json({ success: false, message: 'Only admins can block users' });
    }

    // Can't block yourself
    if (parseInt(userId) === adminId) {
      return res.status(400).json({ success: false, message: 'You cannot block yourself' });
    }

    // Can't block primary admin
    if (await isPrimaryAdmin(groupId, parseInt(userId))) {
      return res.status(403).json({ success: false, message: 'Cannot block the group owner' });
    }

    // Remove from group
    await db.query(
      'DELETE FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, userId]
    );

    // Add to blocked list
    await db.query(
      `INSERT INTO blocked_users (group_id, user_id, blocked_by, reason, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (group_id, user_id) DO UPDATE SET reason = $4, blocked_by = $3, created_at = NOW()`,
      [groupId, userId, adminId, reason || null]
    );

    await logAdminAction(groupId, adminId, 'block_user', userId, { reason });

    res.json({ success: true, message: 'User blocked and removed from group' });
  } catch (error) {
    console.error('Block user error:', error);
    res.status(500).json({ success: false, message: 'Failed to block user' });
  }
});

// Unblock user
router.post('/:groupId/unblock/:userId', auth, async (req, res) => {
  try {
    const { groupId, userId } = req.params;
    const adminId = req.user.id;

    if (!(await isGroupAdmin(groupId, adminId))) {
      return res.status(403).json({ success: false, message: 'Only admins can unblock users' });
    }

    await db.query(
      'DELETE FROM blocked_users WHERE group_id = $1 AND user_id = $2',
      [groupId, userId]
    );

    await logAdminAction(groupId, adminId, 'unblock_user', userId);

    res.json({ success: true, message: 'User unblocked' });
  } catch (error) {
    console.error('Unblock user error:', error);
    res.status(500).json({ success: false, message: 'Failed to unblock user' });
  }
});

// Get blocked users
router.get('/:groupId/blocked', auth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.id;

    if (!(await isGroupAdmin(groupId, userId))) {
      return res.status(403).json({ success: false, message: 'Only admins can view blocked users' });
    }

    const result = await db.query(
      `SELECT bu.*, u.first_name, u.last_name, u.email,
              admin.first_name as blocked_by_first, admin.last_name as blocked_by_last
       FROM blocked_users bu
       JOIN users u ON bu.user_id = u.id
       JOIN users admin ON bu.blocked_by = admin.id
       WHERE bu.group_id = $1
       ORDER BY bu.created_at DESC`,
      [groupId]
    );

    const blockedUsers = result.rows.map(row => ({
      ...row,
      blocked_by_name: `${row.blocked_by_first} ${row.blocked_by_last}`
    }));

    res.json({ success: true, data: { blockedUsers } });
  } catch (error) {
    console.error('Get blocked users error:', error);
    res.status(500).json({ success: false, message: 'Failed to get blocked users' });
  }
});

// Get admin logs
router.get('/:groupId/logs', auth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.id;

    if (!(await isGroupAdmin(groupId, userId))) {
      return res.status(403).json({ success: false, message: 'Only admins can view logs' });
    }

    const result = await db.query(
      `SELECT al.*, 
              admin.first_name as admin_first_name, admin.last_name as admin_last_name,
              target.first_name as target_first_name, target.last_name as target_last_name
       FROM admin_logs al
       JOIN users admin ON al.admin_id = admin.id
       LEFT JOIN users target ON al.target_user_id = target.id
       WHERE al.group_id = $1
       ORDER BY al.created_at DESC
       LIMIT 100`,
      [groupId]
    );

    res.json({ success: true, data: { logs: result.rows } });
  } catch (error) {
    console.error('Get admin logs error:', error);
    res.status(500).json({ success: false, message: 'Failed to get admin logs' });
  }
});

// Transfer ownership
router.post('/:groupId/transfer/:userId', auth, async (req, res) => {
  try {
    const { groupId, userId } = req.params;
    const currentOwnerId = req.user.id;

    // Only primary admin can transfer
    if (!(await isPrimaryAdmin(groupId, currentOwnerId))) {
      return res.status(403).json({ success: false, message: 'Only the group owner can transfer ownership' });
    }

    // Check target is a member
    const membership = await db.query(
      'SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, userId]
    );

    if (membership.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User is not a member of this group' });
    }

    // Update primary admin
    await db.query(
      'UPDATE groups SET primary_admin_id = $1 WHERE id = $2',
      [userId, groupId]
    );

    // Make sure new owner is admin
    await db.query(
      'UPDATE group_members SET role = $1 WHERE group_id = $2 AND user_id = $3',
      ['admin', groupId, userId]
    );

    await logAdminAction(groupId, currentOwnerId, 'transfer_ownership', userId);

    res.json({ success: true, message: 'Ownership transferred successfully' });
  } catch (error) {
    console.error('Transfer ownership error:', error);
    res.status(500).json({ success: false, message: 'Failed to transfer ownership' });
  }
});

export default router;
