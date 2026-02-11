import express from 'express';
import { auth } from '../middleware/auth.js';
import db from '../config/database.js';

const router = express.Router();

// Get all sub-goals for a group
router.get('/group/:groupId', auth, async (req, res) => {
  try {
    const { groupId } = req.params;

    const result = await db.query(
      `SELECT * FROM sub_goals 
       WHERE group_id = $1 
       ORDER BY created_at DESC`,
      [groupId]
    );

    res.json({
      success: true,
      data: { subGoals: result.rows }
    });
  } catch (error) {
    console.error('Get sub-goals error:', error);
    // Return empty array if table doesn't exist yet
    res.json({
      success: true,
      data: { subGoals: [] }
    });
  }
});

// Create a sub-goal
router.post('/group/:groupId', auth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { title, targetAmount, description } = req.body;
    const userId = req.user.id;

    if (!title || !targetAmount) {
      return res.status(400).json({
        success: false,
        message: 'Title and target amount are required'
      });
    }

    const result = await db.query(
      `INSERT INTO sub_goals (group_id, title, description, target_amount, current_amount, created_by, created_at)
       VALUES ($1, $2, $3, $4, 0, $5, NOW())
       RETURNING *`,
      [groupId, title, description || null, targetAmount, userId]
    );

    res.status(201).json({
      success: true,
      message: 'Sub-goal created',
      data: { subGoal: result.rows[0] }
    });
  } catch (error) {
    console.error('Create sub-goal error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create sub-goal'
    });
  }
});

// Update a sub-goal
router.put('/group/:groupId/:subGoalId', auth, async (req, res) => {
  try {
    const { groupId, subGoalId } = req.params;
    const { title, targetAmount, description } = req.body;

    const result = await db.query(
      `UPDATE sub_goals 
       SET title = COALESCE($1, title),
           target_amount = COALESCE($2, target_amount),
           description = COALESCE($3, description),
           updated_at = NOW()
       WHERE id = $4 AND group_id = $5
       RETURNING *`,
      [title, targetAmount, description, subGoalId, groupId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Sub-goal not found'
      });
    }

    res.json({
      success: true,
      message: 'Sub-goal updated',
      data: { subGoal: result.rows[0] }
    });
  } catch (error) {
    console.error('Update sub-goal error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update sub-goal'
    });
  }
});

// Delete a sub-goal
router.delete('/group/:groupId/:subGoalId', auth, async (req, res) => {
  try {
    const { groupId, subGoalId } = req.params;

    await db.query(
      'DELETE FROM sub_goals WHERE id = $1 AND group_id = $2',
      [subGoalId, groupId]
    );

    res.json({
      success: true,
      message: 'Sub-goal deleted'
    });
  } catch (error) {
    console.error('Delete sub-goal error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete sub-goal'
    });
  }
});

// Contribute to a sub-goal
router.post('/group/:groupId/:subGoalId/contribute', auth, async (req, res) => {
  try {
    const { groupId, subGoalId } = req.params;
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid amount is required'
      });
    }

    const result = await db.query(
      `UPDATE sub_goals 
       SET current_amount = current_amount + $1,
           updated_at = NOW()
       WHERE id = $2 AND group_id = $3
       RETURNING *`,
      [amount, subGoalId, groupId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Sub-goal not found'
      });
    }

    res.json({
      success: true,
      message: 'Contribution added',
      data: { subGoal: result.rows[0] }
    });
  } catch (error) {
    console.error('Contribute to sub-goal error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add contribution'
    });
  }
});

export default router;
