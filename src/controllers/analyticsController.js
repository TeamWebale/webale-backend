import pool from '../config/database.js';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';

export const getGroupAnalytics = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { period = '30' } = req.query; // days

    // Get basic stats
    const statsResult = await pool.query(
      `SELECT 
        g.*,
        (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count,
        (SELECT COUNT(*) FROM pledges WHERE group_id = g.id AND status = 'pledged') as active_pledges,
        (SELECT COUNT(*) FROM pledges WHERE group_id = g.id AND status = 'paid') as fulfilled_pledges,
        (SELECT COUNT(*) FROM comments WHERE group_id = g.id) as total_comments,
        (SELECT COUNT(*) FROM activities WHERE group_id = g.id) as total_activities
       FROM groups g
       WHERE g.id = $1`,
      [groupId]
    );

    if (statsResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Group not found' });
    }

    const stats = statsResult.rows[0];

    // Get historical data for charts
    const daysAgo = parseInt(period);
    const startDate = subDays(new Date(), daysAgo);

    const historyResult = await pool.query(
      `SELECT 
        DATE(created_at) as date,
        COUNT(*) as count,
        SUM(CASE WHEN activity_type = 'pledge_made' THEN 
          CAST(activity_data->>'amount' AS DECIMAL) ELSE 0 END) as pledged,
        SUM(CASE WHEN activity_type = 'contribution_made' THEN 
          CAST(activity_data->>'amount' AS DECIMAL) ELSE 0 END) as contributed
       FROM activities
       WHERE group_id = $1 AND created_at >= $2
       GROUP BY DATE(created_at)
       ORDER BY DATE(created_at) ASC`,
      [groupId, startDate]
    );

    // Get top contributors (leaderboard)
    const leaderboardResult = await pool.query(
      `SELECT 
        u.id,
        u.first_name,
        u.last_name,
        u.country,
        COALESCE(SUM(p.amount), 0) as total_contributed,
        COUNT(p.id) as pledge_count
       FROM users u
       INNER JOIN group_members gm ON u.id = gm.user_id
       LEFT JOIN pledges p ON u.id = p.user_id AND p.group_id = $1 AND p.status = 'paid'
       WHERE gm.group_id = $1
       GROUP BY u.id, u.first_name, u.last_name, u.country
       HAVING COALESCE(SUM(p.amount), 0) > 0
       ORDER BY total_contributed DESC
       LIMIT 10`,
      [groupId]
    );

    // Calculate projection
    const projection = calculateProjection(stats);

    res.json({
      success: true,
      data: {
        stats: {
          memberCount: stats.member_count,
          activePledges: stats.active_pledges,
          fulfilledPledges: stats.fulfilled_pledges,
          totalComments: stats.total_comments,
          totalActivities: stats.total_activities,
          goalAmount: parseFloat(stats.goal_amount),
          pledgedAmount: parseFloat(stats.pledged_amount),
          contributedAmount: parseFloat(stats.current_amount),
          pledgedProgress: ((parseFloat(stats.pledged_amount) / parseFloat(stats.goal_amount)) * 100).toFixed(1),
          contributedProgress: ((parseFloat(stats.current_amount) / parseFloat(stats.goal_amount)) * 100).toFixed(1),
        },
        history: historyResult.rows,
        leaderboard: leaderboardResult.rows,
        projection
      }
    });
  } catch (error) {
    console.error('Get analytics error:', error);
    res.status(500).json({ success: false, message: 'Error fetching analytics' });
  }
};

export const exportGroupData = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { format: exportFormat = 'csv' } = req.query;

    // Get group details
    const groupResult = await pool.query('SELECT * FROM groups WHERE id = $1', [groupId]);
    if (groupResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Group not found' });
    }
    const group = groupResult.rows[0];

    // Get all pledges
    const pledgesResult = await pool.query(
      `SELECT 
        p.*,
        u.first_name,
        u.last_name,
        u.email,
        u.country
       FROM pledges p
       INNER JOIN users u ON p.user_id = u.id
       WHERE p.group_id = $1
       ORDER BY p.pledge_date DESC`,
      [groupId]
    );

    // Get all members
    const membersResult = await pool.query(
      `SELECT 
        u.first_name,
        u.last_name,
        u.email,
        u.country,
        gm.role,
        gm.joined_at
       FROM group_members gm
       INNER JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = $1
       ORDER BY gm.joined_at DESC`,
      [groupId]
    );

    if (exportFormat === 'csv') {
      // Generate CSV
      let csv = 'GROUP SUMMARY\n';
      csv += `Name,${group.name}\n`;
      csv += `Goal Amount,${group.goal_amount}\n`;
      csv += `Current Amount,${group.current_amount}\n`;
      csv += `Pledged Amount,${group.pledged_amount}\n`;
      csv += `Members,${membersResult.rows.length}\n`;
      csv += '\n';
      
      csv += 'PLEDGES\n';
      csv += 'Name,Email,Amount,Status,Date,Currency\n';
      pledgesResult.rows.forEach(p => {
        csv += `"${p.first_name} ${p.last_name}","${p.email}",${p.amount},${p.status},${p.pledge_date},${p.pledge_currency}\n`;
      });
      
      csv += '\n';
      csv += 'MEMBERS\n';
      csv += 'Name,Email,Role,Country,Joined Date\n';
      membersResult.rows.forEach(m => {
        csv += `"${m.first_name} ${m.last_name}","${m.email}",${m.role},${m.country || 'N/A'},${m.joined_at}\n`;
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${group.name}-export.csv"`);
      res.send(csv);
    } else {
      // Return JSON
      res.json({
        success: true,
        data: {
          group,
          pledges: pledgesResult.rows,
          members: membersResult.rows
        }
      });
    }
  } catch (error) {
    console.error('Export data error:', error);
    res.status(500).json({ success: false, message: 'Error exporting data' });
  }
};

export const createAnalyticsSnapshot = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { groupId } = req.params;
    const today = format(new Date(), 'yyyy-MM-dd');

    await client.query('BEGIN');

    const groupStats = await client.query(
      `SELECT 
        pledged_amount,
        current_amount,
        (SELECT COUNT(*) FROM group_members WHERE group_id = $1) as member_count,
        (SELECT COUNT(*) FROM pledges WHERE group_id = $1 AND status = 'pledged') as active_pledges
       FROM groups
       WHERE id = $1`,
      [groupId]
    );

    if (groupStats.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Group not found' });
    }

    const stats = groupStats.rows[0];

    await client.query(
      `INSERT INTO analytics_snapshots 
       (group_id, snapshot_date, total_pledged, total_contributed, member_count, active_pledges)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (group_id, snapshot_date) 
       DO UPDATE SET 
         total_pledged = $3,
         total_contributed = $4,
         member_count = $5,
         active_pledges = $6`,
      [
        groupId,
        today,
        stats.pledged_amount,
        stats.current_amount,
        stats.member_count,
        stats.active_pledges
      ]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Analytics snapshot created successfully'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create snapshot error:', error);
    res.status(500).json({ success: false, message: 'Error creating snapshot' });
  } finally {
    client.release();
  }
};

// Helper function to calculate goal projection
const calculateProjection = (stats) => {
  const goalAmount = parseFloat(stats.goal_amount);
  const currentAmount = parseFloat(stats.current_amount);
  const remaining = goalAmount - currentAmount;

  if (remaining <= 0) {
    return {
      estimatedCompletionDate: new Date().toISOString(),
      daysRemaining: 0,
      averageDailyContribution: 0,
      message: 'Goal already reached!'
    };
  }

  // Simple projection based on average daily contribution (last 30 days)
  const thirtyDaysAgo = subDays(new Date(), 30);
  const dailyAverage = currentAmount / 30; // Rough estimate

  if (dailyAverage <= 0) {
    return {
      estimatedCompletionDate: null,
      daysRemaining: null,
      averageDailyContribution: 0,
      message: 'Not enough data for projection'
    };
  }

  const daysRemaining = Math.ceil(remaining / dailyAverage);
  const estimatedDate = new Date();
  estimatedDate.setDate(estimatedDate.getDate() + daysRemaining);

  return {
    estimatedCompletionDate: estimatedDate.toISOString(),
    daysRemaining,
    averageDailyContribution: dailyAverage.toFixed(2),
    message: `Projected to reach goal in ${daysRemaining} days`
  };
};