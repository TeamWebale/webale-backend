import express from 'express';
import { auth } from '../middleware/auth.js';
import db from '../config/database.js';

const router = express.Router();

// Log an audit event (internal helper - exported for use in other routes)
export const logAuditEvent = async ({
  groupId,
  actorId,
  actionType,
  targetType = null,
  targetId = null,
  description = null,
  details = {},
  ipAddress = null,
  userAgent = null
}) => {
  try {
    await db.query(
      `INSERT INTO audit_logs 
       (group_id, actor_id, action_type, target_type, target_id, description, details, ip_address, user_agent, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [groupId, actorId, actionType, targetType, targetId, description, JSON.stringify(details), ipAddress, userAgent]
    );
  } catch (error) {
    console.error('Audit log error:', error);
    // Don't throw - audit logging should not break main operations
  }
};

// Get audit logs for a group
router.get('/group/:groupId', auth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { page = 1, limit = 50, actionType, startDate, endDate } = req.query;
    const offset = (page - 1) * limit;

    // Verify user is member of group
    const memberCheck = await db.query(
      'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, req.user.id]
    );

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ success: false, message: 'Not a member of this group' });
    }

    // Build query with filters
    let query = `
      SELECT 
        al.*,
        actor.first_name as actor_first_name,
        actor.last_name as actor_last_name,
        CONCAT(actor.first_name, ' ', actor.last_name) as actor_name,
        CASE 
          WHEN al.target_type = 'user' THEN (SELECT CONCAT(first_name, ' ', last_name) FROM users WHERE id = al.target_id)
          WHEN al.target_type = 'pledge' THEN (SELECT CONCAT('Pledge #', id) FROM pledges WHERE id = al.target_id)
          ELSE NULL
        END as target_name
      FROM audit_logs al
      LEFT JOIN users actor ON al.actor_id = actor.id
      WHERE al.group_id = $1
    `;
    
    const params = [groupId];
    let paramIndex = 2;

    if (actionType) {
      query += ` AND al.action_type = $${paramIndex}`;
      params.push(actionType);
      paramIndex++;
    }

    if (startDate) {
      query += ` AND al.created_at >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      query += ` AND al.created_at <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    query += ` ORDER BY al.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await db.query(query, params);

    // Get total count
    const countResult = await db.query(
      'SELECT COUNT(*) FROM audit_logs WHERE group_id = $1',
      [groupId]
    );

    res.json({
      success: true,
      data: {
        logs: result.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: parseInt(countResult.rows[0].count),
          hasMore: offset + result.rows.length < parseInt(countResult.rows[0].count)
        }
      }
    });
  } catch (error) {
    console.error('Get audit logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get audit logs'
    });
  }
});

// Get audit log summary/stats
router.get('/group/:groupId/summary', auth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { days = 30 } = req.query;

    const result = await db.query(
      `SELECT 
         action_type,
         COUNT(*) as count,
         MAX(created_at) as last_occurrence
       FROM audit_logs
       WHERE group_id = $1 
         AND created_at >= NOW() - INTERVAL '1 day' * $2
       GROUP BY action_type
       ORDER BY count DESC`,
      [groupId, parseInt(days)]
    );

    const totalResult = await db.query(
      `SELECT COUNT(*) as total
       FROM audit_logs
       WHERE group_id = $1
         AND created_at >= NOW() - INTERVAL '1 day' * $2`,
      [groupId, parseInt(days)]
    );

    res.json({
      success: true,
      data: {
        summary: result.rows,
        totalActions: parseInt(totalResult.rows[0].total),
        periodDays: parseInt(days)
      }
    });
  } catch (error) {
    console.error('Get audit summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get audit summary'
    });
  }
});

// Get activity timeline for a specific user in a group
router.get('/group/:groupId/user/:userId', auth, async (req, res) => {
  try {
    const { groupId, userId } = req.params;
    const { limit = 20 } = req.query;

    const result = await db.query(
      `SELECT 
        al.*,
        CONCAT(actor.first_name, ' ', actor.last_name) as actor_name
       FROM audit_logs al
       LEFT JOIN users actor ON al.actor_id = actor.id
       WHERE al.group_id = $1 
         AND (al.actor_id = $2 OR al.target_id = $2)
       ORDER BY al.created_at DESC
       LIMIT $3`,
      [groupId, userId, parseInt(limit)]
    );

    res.json({
      success: true,
      data: { logs: result.rows }
    });
  } catch (error) {
    console.error('Get user audit logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user activity'
    });
  }
});

export default router;
