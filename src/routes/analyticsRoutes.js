import express from 'express';
import { auth } from '../middleware/auth.js';
import db from '../config/database.js';

const router = express.Router();

// Get group analytics overview
router.get('/group/:groupId', auth, async (req, res) => {
  try {
    const { groupId } = req.params;

    // Get pledge stats
    const pledgeStats = await db.query(
      `SELECT 
         COUNT(*) as total_pledges,
         COUNT(CASE WHEN status = 'paid' THEN 1 END) as paid_pledges,
         COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_pledges,
         COUNT(CASE WHEN status = 'partial' THEN 1 END) as partial_pledges,
         COALESCE(SUM(amount), 0) as total_pledged,
         COALESCE(SUM(amount_paid), 0) as total_received,
         COALESCE(AVG(amount), 0) as average_pledge
       FROM pledges
       WHERE group_id = $1`,
      [groupId]
    );

    // Get member stats
    const memberStats = await db.query(
      `SELECT 
         COUNT(*) as total_members,
         COUNT(CASE WHEN role = 'admin' THEN 1 END) as admin_count,
         COUNT(CASE WHEN role = 'member' THEN 1 END) as member_count
       FROM group_members
       WHERE group_id = $1`,
      [groupId]
    );

    // Get group goal
    const groupInfo = await db.query(
      'SELECT goal_amount, currency, created_at FROM groups WHERE id = $1',
      [groupId]
    );

    const goal = parseFloat(groupInfo.rows[0]?.goal_amount || 0);
    const received = parseFloat(pledgeStats.rows[0]?.total_received || 0);
    const pledged = parseFloat(pledgeStats.rows[0]?.total_pledged || 0);

    res.json({
      success: true,
      data: {
        pledges: {
          total: parseInt(pledgeStats.rows[0]?.total_pledges || 0),
          paid: parseInt(pledgeStats.rows[0]?.paid_pledges || 0),
          pending: parseInt(pledgeStats.rows[0]?.pending_pledges || 0),
          partial: parseInt(pledgeStats.rows[0]?.partial_pledges || 0),
          totalPledged: pledged,
          totalReceived: received,
          averagePledge: parseFloat(pledgeStats.rows[0]?.average_pledge || 0)
        },
        members: {
          total: parseInt(memberStats.rows[0]?.total_members || 0),
          admins: parseInt(memberStats.rows[0]?.admin_count || 0),
          members: parseInt(memberStats.rows[0]?.member_count || 0)
        },
        progress: {
          goalAmount: goal,
          pledgedPercent: goal > 0 ? ((pledged / goal) * 100).toFixed(1) : 0,
          receivedPercent: goal > 0 ? ((received / goal) * 100).toFixed(1) : 0,
          collectionRate: pledged > 0 ? ((received / pledged) * 100).toFixed(1) : 0
        },
        currency: groupInfo.rows[0]?.currency || 'USD'
      }
    });
  } catch (error) {
    console.error('Get analytics error:', error);
    res.status(500).json({ success: false, message: 'Failed to get analytics' });
  }
});

// Get pledge analytics with trends
router.get('/group/:groupId/pledges', auth, async (req, res) => {
  try {
    const { groupId } = req.params;

    // Pledges by status
    const byStatus = await db.query(
      `SELECT status, COUNT(*) as count, COALESCE(SUM(amount), 0) as total
       FROM pledges WHERE group_id = $1
       GROUP BY status`,
      [groupId]
    );

    // Pledges over time (last 30 days)
    const overTime = await db.query(
      `SELECT 
         DATE(created_at) as date,
         COUNT(*) as count,
         COALESCE(SUM(amount), 0) as amount
       FROM pledges 
       WHERE group_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
       GROUP BY DATE(created_at)
       ORDER BY date`,
      [groupId]
    );

    // Top pledgers
    const topPledgers = await db.query(
      `SELECT 
         u.id, u.first_name, u.last_name,
         COUNT(p.id) as pledge_count,
         COALESCE(SUM(p.amount), 0) as total_pledged,
         COALESCE(SUM(p.amount_paid), 0) as total_paid
       FROM pledges p
       JOIN users u ON p.user_id = u.id
       WHERE p.group_id = $1 AND p.is_anonymous = false
       GROUP BY u.id, u.first_name, u.last_name
       ORDER BY total_pledged DESC
       LIMIT 10`,
      [groupId]
    );

    res.json({
      success: true,
      data: {
        byStatus: byStatus.rows,
        overTime: overTime.rows,
        topPledgers: topPledgers.rows
      }
    });
  } catch (error) {
    console.error('Get pledge analytics error:', error);
    res.status(500).json({ success: false, message: 'Failed to get pledge analytics' });
  }
});

// Get member analytics
router.get('/group/:groupId/members', auth, async (req, res) => {
  try {
    const { groupId } = req.params;

    // Members with pledge stats
    const memberStats = await db.query(
      `SELECT 
         u.id, u.first_name, u.last_name, u.email, u.country,
         gm.role, gm.joined_at,
         COUNT(p.id) as pledge_count,
         COALESCE(SUM(p.amount), 0) as total_pledged,
         COALESCE(SUM(p.amount_paid), 0) as total_paid
       FROM group_members gm
       JOIN users u ON gm.user_id = u.id
       LEFT JOIN pledges p ON p.user_id = u.id AND p.group_id = gm.group_id
       WHERE gm.group_id = $1
       GROUP BY u.id, u.first_name, u.last_name, u.email, u.country, gm.role, gm.joined_at
       ORDER BY total_pledged DESC`,
      [groupId]
    );

    // Members joined over time
    const joinedOverTime = await db.query(
      `SELECT 
         DATE(joined_at) as date,
         COUNT(*) as count
       FROM group_members
       WHERE group_id = $1 AND joined_at >= NOW() - INTERVAL '30 days'
       GROUP BY DATE(joined_at)
       ORDER BY date`,
      [groupId]
    );

    res.json({
      success: true,
      data: {
        members: memberStats.rows,
        joinedOverTime: joinedOverTime.rows
      }
    });
  } catch (error) {
    console.error('Get member analytics error:', error);
    res.status(500).json({ success: false, message: 'Failed to get member analytics' });
  }
});

// Get trends
router.get('/group/:groupId/trends', auth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { period = '30d' } = req.query;

    const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;

    // Daily pledges and contributions
    const trends = await db.query(
      `SELECT 
         DATE(created_at) as date,
         COUNT(*) as pledge_count,
         COALESCE(SUM(amount), 0) as pledged_amount,
         COALESCE(SUM(amount_paid), 0) as received_amount
       FROM pledges
       WHERE group_id = $1 AND created_at >= NOW() - INTERVAL '${days} days'
       GROUP BY DATE(created_at)
       ORDER BY date`,
      [groupId]
    );

    res.json({
      success: true,
      data: {
        period,
        trends: trends.rows
      }
    });
  } catch (error) {
    console.error('Get trends error:', error);
    res.status(500).json({ success: false, message: 'Failed to get trends' });
  }
});

export default router;
