import pool from '../config/database.js';

export const createSubGoal = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { title, amount, position } = req.body;
    const userId = req.user.id;

    // Check if user is admin
    const roleCheck = await pool.query(
      'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, userId]
    );

    if (roleCheck.rows.length === 0 || roleCheck.rows[0].role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins can create sub-goals' });
    }

    const result = await pool.query(
      `INSERT INTO sub_goals (group_id, title, amount, position)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [groupId, title, parseFloat(amount), position || 0]
    );

    res.json({
      success: true,
      data: { subGoal: result.rows[0] },
      message: 'Sub-goal created successfully'
    });
  } catch (error) {
    console.error('Create sub-goal error:', error);
    res.status(500).json({ success: false, message: 'Error creating sub-goal' });
  }
};

export const getGroupSubGoals = async (req, res) => {
  try {
    const { groupId } = req.params;

    const result = await pool.query(
      `SELECT * FROM sub_goals
       WHERE group_id = $1
       ORDER BY position ASC, created_at ASC`,
      [groupId]
    );

    res.json({
      success: true,
      data: { subGoals: result.rows }
    });
  } catch (error) {
    console.error('Get sub-goals error:', error);
    res.status(500).json({ success: false, message: 'Error fetching sub-goals' });
  }
};

export const updateSubGoal = async (req, res) => {
  try {
    const { subGoalId } = req.params;
    const { title, amount, currentAmount, isCompleted } = req.body;
    const userId = req.user.id;

    // Check if user is admin
    const subGoalInfo = await pool.query(
      `SELECT sg.group_id, gm.role 
       FROM sub_goals sg
       LEFT JOIN group_members gm ON sg.group_id = gm.group_id AND gm.user_id = $1
       WHERE sg.id = $2`,
      [userId, subGoalId]
    );

    if (subGoalInfo.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Sub-goal not found' });
    }

    if (subGoalInfo.rows[0].role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins can update sub-goals' });
    }

    const result = await pool.query(
      `UPDATE sub_goals 
       SET title = COALESCE($1, title),
           amount = COALESCE($2, amount),
           current_amount = COALESCE($3, current_amount),
           is_completed = COALESCE($4, is_completed)
       WHERE id = $5
       RETURNING *`,
      [title, amount ? parseFloat(amount) : null, currentAmount ? parseFloat(currentAmount) : null, isCompleted, subGoalId]
    );

    res.json({
      success: true,
      data: { subGoal: result.rows[0] },
      message: 'Sub-goal updated successfully'
    });
  } catch (error) {
    console.error('Update sub-goal error:', error);
    res.status(500).json({ success: false, message: 'Error updating sub-goal' });
  }
};

export const deleteSubGoal = async (req, res) => {
  try {
    const { subGoalId } = req.params;
    const userId = req.user.id;

    // Check if user is admin
    const subGoalInfo = await pool.query(
      `SELECT sg.group_id, gm.role 
       FROM sub_goals sg
       LEFT JOIN group_members gm ON sg.group_id = gm.group_id AND gm.user_id = $1
       WHERE sg.id = $2`,
      [userId, subGoalId]
    );

    if (subGoalInfo.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Sub-goal not found' });
    }

    if (subGoalInfo.rows[0].role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins can delete sub-goals' });
    }

    await pool.query('DELETE FROM sub_goals WHERE id = $1', [subGoalId]);

    res.json({ success: true, message: 'Sub-goal deleted successfully' });
  } catch (error) {
    console.error('Delete sub-goal error:', error);
    res.status(500).json({ success: false, message: 'Error deleting sub-goal' });
  }
};