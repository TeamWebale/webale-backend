import pool from '../config/database.js';
import { logActivity, ACTIVITY_TYPES } from '../utils/activityLogger.js';

export const createNotice = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { title, content, isPinned } = req.body;
    const userId = req.user.id;

    // Check if user is admin
    const roleCheck = await pool.query(
      'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, userId]
    );

    if (roleCheck.rows.length === 0 || roleCheck.rows[0].role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins can create notices' });
    }

    const result = await pool.query(
      `INSERT INTO notices (group_id, user_id, title, content, is_pinned)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [groupId, userId, title, content, isPinned || false]
    );

    res.json({
      success: true,
      data: { notice: result.rows[0] },
      message: 'Notice created successfully'
    });
  } catch (error) {
    console.error('Create notice error:', error);
    res.status(500).json({ success: false, message: 'Error creating notice' });
  }
};

export const getGroupNotices = async (req, res) => {
  try {
    const { groupId } = req.params;

    const result = await pool.query(
      `SELECT 
        n.*,
        u.first_name,
        u.last_name,
        u.country,
        (SELECT COUNT(*) FROM notice_responses WHERE notice_id = n.id) as response_count
       FROM notices n
       INNER JOIN users u ON n.user_id = u.id
       WHERE n.group_id = $1
       ORDER BY n.is_pinned DESC, n.created_at DESC`,
      [groupId]
    );

    res.json({
      success: true,
      data: { notices: result.rows }
    });
  } catch (error) {
    console.error('Get notices error:', error);
    res.status(500).json({ success: false, message: 'Error fetching notices' });
  }
};

export const respondToNotice = async (req, res) => {
  try {
    const { noticeId } = req.params;
    const { responseText } = req.body;
    const userId = req.user.id;

    if (!responseText || !responseText.trim()) {
      return res.status(400).json({ success: false, message: 'Response text is required' });
    }

    const result = await pool.query(
      `INSERT INTO notice_responses (notice_id, user_id, response_text)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [noticeId, userId, responseText.trim()]
    );

    res.json({
      success: true,
      data: { response: result.rows[0] },
      message: 'Response added successfully'
    });
  } catch (error) {
    console.error('Respond to notice error:', error);
    res.status(500).json({ success: false, message: 'Error adding response' });
  }
};

export const getNoticeResponses = async (req, res) => {
  try {
    const { noticeId } = req.params;

    const result = await pool.query(
      `SELECT 
        nr.*,
        u.first_name,
        u.last_name,
        u.country
       FROM notice_responses nr
       INNER JOIN users u ON nr.user_id = u.id
       WHERE nr.notice_id = $1
       ORDER BY nr.created_at ASC`,
      [noticeId]
    );

    res.json({
      success: true,
      data: { responses: result.rows }
    });
  } catch (error) {
    console.error('Get responses error:', error);
    res.status(500).json({ success: false, message: 'Error fetching responses' });
  }
};

export const deleteNotice = async (req, res) => {
  try {
    const { noticeId } = req.params;
    const userId = req.user.id;

    // Check if user is admin
    const noticeInfo = await pool.query(
      `SELECT n.group_id, gm.role 
       FROM notices n
       LEFT JOIN group_members gm ON n.group_id = gm.group_id AND gm.user_id = $1
       WHERE n.id = $2`,
      [userId, noticeId]
    );

    if (noticeInfo.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Notice not found' });
    }

    if (noticeInfo.rows[0].role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins can delete notices' });
    }

    await pool.query('DELETE FROM notices WHERE id = $1', [noticeId]);

    res.json({ success: true, message: 'Notice deleted successfully' });
  } catch (error) {
    console.error('Delete notice error:', error);
    res.status(500).json({ success: false, message: 'Error deleting notice' });
  }
};