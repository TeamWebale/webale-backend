import express from 'express';
import db from '../config/database.js';
import jwt from 'jsonwebtoken';

const router = express.Router();

const requirePlatformAdmin = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ success: false, message: 'No token' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const result = await db.query('SELECT id, email, is_platform_admin FROM users WHERE id = $1', [decoded.userId || decoded.id]);
    if (!result.rows[0]?.is_platform_admin) return res.status(403).json({ success: false, message: 'Platform admin access required' });
    req.adminUser = result.rows[0];
    next();
  } catch (err) {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

router.get('/stats', requirePlatformAdmin, async (req, res) => {
  try {
    const [users, groups, pledges, received, newUsers, newGroups, topGroups, recentUsers] = await Promise.all([
      db.query('SELECT COUNT(*) as total FROM users'),
      db.query('SELECT COUNT(*) as total FROM groups'),
      db.query("SELECT COUNT(*) as total, COALESCE(SUM(amount),0) as volume FROM pledges WHERE status != 'cancelled'"),
      db.query('SELECT COALESCE(SUM(current_amount),0) as total FROM groups'),
      db.query("SELECT COUNT(*) as total FROM users WHERE created_at >= NOW() - INTERVAL '30 days'"),
      db.query("SELECT COUNT(*) as total FROM groups WHERE created_at >= NOW() - INTERVAL '30 days'"),
      db.query("SELECT g.id, g.name, g.current_amount, g.pledged_amount, g.goal_amount, g.currency, u.first_name || ' ' || u.last_name as owner, (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) as member_count FROM groups g JOIN users u ON g.created_by = u.id ORDER BY g.current_amount DESC LIMIT 5"),
      db.query('SELECT id, first_name, last_name, email, country, created_at, is_verified FROM users ORDER BY created_at DESC LIMIT 10'),
    ]);
    res.json({ success: true, data: {
      stats: {
        totalUsers: parseInt(users.rows[0].total),
        totalGroups: parseInt(groups.rows[0].total),
        totalPledges: parseInt(pledges.rows[0].total),
        totalPledged: parseFloat(pledges.rows[0].volume),
        totalReceived: parseFloat(received.rows[0].total),
        newUsers30d: parseInt(newUsers.rows[0].total),
        newGroups30d: parseInt(newGroups.rows[0].total),
      },
      topGroups: topGroups.rows,
      recentUsers: recentUsers.rows,
    }});
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ success: false, message: 'Failed to load stats' });
  }
});

router.get('/users', requirePlatformAdmin, async (req, res) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const params = search ? ['%' + search + '%'] : [];
    const where = search ? 'WHERE (u.email ILIKE $1 OR u.first_name ILIKE $1 OR u.last_name ILIKE $1)' : '';
    const [result, count] = await Promise.all([
      db.query('SELECT u.id, u.first_name, u.last_name, u.email, u.country, u.created_at, u.is_verified, u.is_platform_admin, u.avatar_url, (SELECT COUNT(*) FROM group_members gm WHERE gm.user_id = u.id) as group_count, (SELECT COUNT(*) FROM pledges p WHERE p.user_id = u.id) as pledge_count, (SELECT COALESCE(SUM(p.amount),0) FROM pledges p WHERE p.user_id = u.id) as total_pledged FROM users u ' + where + ' ORDER BY u.created_at DESC LIMIT ' + limit + ' OFFSET ' + offset, params),
      db.query('SELECT COUNT(*) FROM users u ' + where, params)
    ]);
    res.json({ success: true, data: { users: result.rows, total: parseInt(count.rows[0].count) } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load users' });
  }
});

router.get('/groups', requirePlatformAdmin, async (req, res) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const params = search ? ['%' + search + '%'] : [];
    const where = search ? 'WHERE (g.name ILIKE $1 OR u.email ILIKE $1)' : '';
    const [result, count] = await Promise.all([
      db.query("SELECT g.id, g.name, g.currency, g.goal_amount, g.current_amount, g.pledged_amount, g.created_at, g.deadline, u.first_name || ' ' || u.last_name as owner, u.email as owner_email, (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) as member_count, (SELECT COUNT(*) FROM pledges p WHERE p.group_id = g.id) as pledge_count FROM groups g JOIN users u ON g.created_by = u.id " + where + ' ORDER BY g.created_at DESC LIMIT ' + limit + ' OFFSET ' + offset, params),
      db.query('SELECT COUNT(*) FROM groups g JOIN users u ON g.created_by = u.id ' + where, params)
    ]);
    res.json({ success: true, data: { groups: result.rows, total: parseInt(count.rows[0].count) } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load groups' });
  }
});

router.delete('/users/:id', requirePlatformAdmin, async (req, res) => {
  try {
    if (parseInt(req.params.id) === req.adminUser.id) return res.status(400).json({ success: false, message: 'Cannot delete your own account' });
    await db.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete user' });
  }
});

router.put('/users/:id/verify', requirePlatformAdmin, async (req, res) => {
  try {
    await db.query('UPDATE users SET is_verified = true WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'User verified' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to verify user' });
  }
});

router.delete('/groups/:id', requirePlatformAdmin, async (req, res) => {
  try {
    await db.query('DELETE FROM groups WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Group deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete group' });
  }
});

export default router;
