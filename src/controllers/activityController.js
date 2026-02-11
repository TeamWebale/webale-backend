import pool from '../config/database.js';

export const getActivities = async (req, res) => {
  try {
    const { limit } = req.query;
    
    const result = await pool.query(
      `SELECT a.*, u.first_name, u.last_name, g.name as group_name
       FROM activities a
       INNER JOIN users u ON a.user_id = u.id
       INNER JOIN groups g ON a.group_id = g.id
       INNER JOIN group_members gm ON g.id = gm.group_id
       WHERE gm.user_id = $1
       ORDER BY a.created_at DESC
       ${limit ? 'LIMIT $2' : ''}`,
      limit ? [req.user.id, parseInt(limit)] : [req.user.id]
    );
    
    res.json({
      success: true,
      data: { activities: result.rows }
    });
  } catch (error) {
    console.error('Get activities error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching activities'
    });
  }
};

export const getGroupActivities = async (req, res) => {
  try {
    const { id } = req.params;
    const { limit } = req.query;
    
    const result = await pool.query(
      `SELECT a.*, u.first_name, u.last_name, g.name as group_name
       FROM activities a
       INNER JOIN users u ON a.user_id = u.id
       INNER JOIN groups g ON a.group_id = g.id
       WHERE a.group_id = $1
       ORDER BY a.created_at DESC
       ${limit ? 'LIMIT $2' : ''}`,
      limit ? [id, parseInt(limit)] : [id]
    );
    
    res.json({
      success: true,
      data: { activities: result.rows }
    });
  } catch (error) {
    console.error('Get group activities error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching group activities'
    });
  }
};