import pool from '../config/database.js';
import { logActivity, ACTIVITY_TYPES } from '../utils/activityLogger.js';

export const createPledge = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { groupId } = req.params;
    const { 
      amount, 
      fulfillmentDate, 
      reminderFrequency, 
      isAnonymous,
      currency,
      pledge_currency,
      originalAmount,
      donorName
    } = req.body;
    const userId = req.user.id;

    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Please enter the amount you wish to pledge'
      });
    }

    await client.query('BEGIN');

    // Check if user is member of group
    const memberCheck = await client.query(
      'SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, userId]
    );

    if (memberCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        success: false,
        message: 'You must be a member to pledge'
      });
    }

    // Insert new pledge (allow multiple pledges) 
    const pledgeResult = await client.query(
      `INSERT INTO pledges (
        group_id, user_id, amount, status, recorded_by,
        fulfillment_date, reminder_frequency, is_anonymous,
        pledge_currency, original_amount, donor_name
      )
       VALUES ($1, $2, $3, 'pledged', $2, $4, $5, $6, $7, $8, $9)
       
       RETURNING *`,
      [
        groupId, 
        userId, 
        parseFloat(amount),
        fulfillmentDate || null,
        reminderFrequency || 'none',
        isAnonymous || false,
        pledge_currency || currency || 'USD',
        originalAmount ? parseFloat(originalAmount) : parseFloat(amount),
        donorName || null
      ]
    );

    const pledge = pledgeResult.rows[0];

    // Update group's pledged_amount
    await client.query(
      `UPDATE groups 
       SET pledged_amount = (
         SELECT COALESCE(SUM(amount), 0) 
         FROM pledges 
         WHERE group_id = $1
       )
       WHERE id = $1`,
      [groupId]
    );

    // Create or update reminder if frequency is set
    if (reminderFrequency && reminderFrequency !== 'none') {
      const nextReminderDate = calculateNextReminderDate(reminderFrequency);
      
      // Check if reminder already exists
      const existingReminder = await client.query(
        'SELECT id FROM reminders WHERE pledge_id = $1',
        [pledge.id]
      );
      
      if (existingReminder.rows.length > 0) {
        // Update existing reminder
        await client.query(
          `UPDATE reminders 
           SET reminder_type = $1, next_reminder_date = $2, status = 'active'
           WHERE pledge_id = $3`,
          [reminderFrequency, nextReminderDate, pledge.id]
        );
      } else {
        // Create new reminder
        await client.query(
          `INSERT INTO reminders (pledge_id, user_id, group_id, reminder_type, next_reminder_date, status)
           VALUES ($1, $2, $3, $4, $5, 'active')`,
          [pledge.id, userId, groupId, reminderFrequency, nextReminderDate]
        );
      }
    } else if (reminderFrequency === 'none') {
      // Deactivate any existing reminders
      await client.query(
        `UPDATE reminders SET status = 'inactive' WHERE pledge_id = $1`,
        [pledge.id]
      );
    }

    await logActivity(userId, groupId, ACTIVITY_TYPES.PLEDGE_MADE, {
      amount: parseFloat(amount),
      isAnonymous: isAnonymous || false,
    });

    // Check for milestones
    await checkMilestones(client, groupId, 'pledged');

    // Auto-DM: admin sends thank-you note to the pledging member
    try {
      const adminResult = await client.query(
        `SELECT u.id, u.first_name, u.last_name FROM group_members gm
         JOIN users u ON u.id = gm.user_id
         WHERE gm.group_id = $1 AND gm.role = 'admin' LIMIT 1`,
        [groupId]
      );
      const memberResult = await client.query(
        'SELECT first_name, last_name FROM users WHERE id = $1',
        [userId]
      );
      if (adminResult.rows.length > 0 && memberResult.rows.length > 0) {
        const admin = adminResult.rows[0];
        const member = memberResult.rows[0];
        const groupResult = await client.query('SELECT name, currency FROM groups WHERE id = $1', [groupId]);
        const groupName = groupResult.rows[0]?.name || 'our group';
        const displayCurrency = pledge_currency || currency || groupResult.rows[0]?.currency || 'USD';
        const displayAmount = originalAmount ? parseFloat(originalAmount) : parseFloat(amount);
        const thankYouMsg = `Dear ${member.first_name} ${member.last_name},\n\nThank you for your generous pledge of ${displayCurrency} ${displayAmount.toLocaleString()} to "${groupName}"! 🙏\n\nWe greatly appreciate your commitment and support. Your participation makes a real difference and brings us closer to our goal.\n\nThank you and have a nice day! 😊\n\nWarm regards,\n${admin.first_name} ${admin.last_name}`;
        await client.query(
          'INSERT INTO messages (group_id, sender_id, recipient_id, content, message_type, is_read, created_at) VALUES ($1, $2, $3, $4, $5, false, NOW())',
          [groupId, admin.id, userId, thankYouMsg, 'text']
        );
      }
    } catch (dmErr) { console.error('Pledge thank-you DM error:', dmErr.message); }

    await client.query('COMMIT');

    res.json({
      success: true,
      data: { pledge: pledgeResult.rows[0] },
      message: 'Pledge recorded successfully'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create pledge error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating pledge'
    });
  } finally {
    client.release();
  }
};

export const cancelPledge = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { groupId, pledgeId } = req.params;

    // Check if user owns the pledge
    const pledgeCheck = await client.query(
      'SELECT * FROM pledges WHERE id = $1 AND group_id = $2 AND user_id = $3',
      [pledgeId, groupId, req.user.id]
    );

    if (pledgeCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Pledge not found or access denied'
      });
    }

    const pledge = pledgeCheck.rows[0];

    await client.query('BEGIN');

    // Delete the pledge
    await client.query('DELETE FROM pledges WHERE id = $1', [pledgeId]);

    // Update group's pledged_amount
    await client.query(
      `UPDATE groups 
       SET pledged_amount = (
         SELECT COALESCE(SUM(amount), 0) 
         FROM pledges 
         WHERE group_id = $1
       )
       WHERE id = $1`,
      [groupId]
    );

    // Delete associated reminders
    await client.query('DELETE FROM reminders WHERE pledge_id = $1', [pledgeId]);

    await logActivity(req.user.id, groupId, ACTIVITY_TYPES.PLEDGE_CANCELLED, {
      amount: parseFloat(pledge.amount),
    });

    // Auto-DM: admin sends acknowledgement of pledge cancellation
    try {
      const adminResult = await client.query(
        `SELECT u.id, u.first_name, u.last_name FROM group_members gm
         JOIN users u ON u.id = gm.user_id
         WHERE gm.group_id = $1 AND gm.role = 'admin' LIMIT 1`,
        [groupId]
      );
      const memberResult = await client.query(
        'SELECT first_name, last_name FROM users WHERE id = $1',
        [req.user.id]
      );
      if (adminResult.rows.length > 0 && memberResult.rows.length > 0) {
        const admin = adminResult.rows[0];
        const member = memberResult.rows[0];
        const groupResult = await client.query('SELECT name, currency FROM groups WHERE id = $1', [groupId]);
        const groupName = groupResult.rows[0]?.name || 'our group';
        const displayCurrency = pledge.pledge_currency || groupResult.rows[0]?.currency || 'USD';
        const displayAmount = pledge.original_amount ? parseFloat(pledge.original_amount) : parseFloat(pledge.amount);
        const cancelMsg = `Dear ${member.first_name} ${member.last_name},\n\nWe acknowledge your pledge cancellation of ${displayCurrency} ${displayAmount.toLocaleString()} in "${groupName}".\n\nWe understand circumstances change. Should you wish to contribute in the future, you are always welcome. Thank you for your consideration and have a nice day! 🙏\n\nWarm regards,\n${admin.first_name} ${admin.last_name}`;
        await client.query(
          'INSERT INTO messages (group_id, sender_id, recipient_id, content, message_type, is_read, created_at) VALUES ($1, $2, $3, $4, $5, false, NOW())',
          [groupId, admin.id, req.user.id, cancelMsg, 'text']
        );
      }
    } catch (dmErr) { console.error('Pledge cancellation DM error:', dmErr.message); }

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Pledge cancelled successfully'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Cancel pledge error:', error);
    res.status(500).json({
      success: false,
      message: 'Error cancelling pledge'
    });
  } finally {
    client.release();
  }
};

// =====================================================
// ADD THIS to pledgeController.js AFTER the cancelPledge export
// =====================================================

export const updatePledge = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { groupId, pledgeId } = req.params;
    const { amount, fulfillmentDate, reminderFrequency, isAnonymous, currency, pledge_currency, originalAmount, notes } = req.body;
    const userId = req.user.id;

    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid pledge amount' });
    }

    // Check if user owns this pledge
    const pledgeCheck = await client.query(
      'SELECT * FROM pledges WHERE id = $1 AND group_id = $2 AND user_id = $3',
      [pledgeId, groupId, userId]
    );

    if (pledgeCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Pledge not found or access denied' });
    }

    const oldPledge = pledgeCheck.rows[0];
    if (oldPledge.status === 'paid') {
      return res.status(400).json({ success: false, message: 'Cannot revise a paid pledge' });
    }

    await client.query('BEGIN');

    // Update pledge
    const result = await client.query(
      `UPDATE pledges SET 
        amount = $1,
        fulfillment_date = $2,
        reminder_frequency = $3,
        is_anonymous = $4,
        pledge_currency = $5,
        original_amount = $6,
        notes = $7
       WHERE id = $8 AND group_id = $9
       RETURNING *`,
      [
        parseFloat(amount),
        fulfillmentDate || null,
        reminderFrequency || 'none',
        isAnonymous || false,
        pledge_currency || currency || 'USD',
        originalAmount ? parseFloat(originalAmount) : parseFloat(amount),
        notes || null,
        pledgeId,
        groupId
      ]
    );

    // Update group's pledged_amount
    await client.query(
      `UPDATE groups SET pledged_amount = (
        SELECT COALESCE(SUM(amount), 0) FROM pledges WHERE group_id = $1
      ) WHERE id = $1`,
      [groupId]
    );

    // Update reminders
    if (reminderFrequency && reminderFrequency !== 'none') {
      const nextReminderDate = calculateNextReminderDate(reminderFrequency);
      const existingReminder = await client.query(
        'SELECT id FROM reminders WHERE pledge_id = $1', [pledgeId]
      );
      if (existingReminder.rows.length > 0) {
        await client.query(
          `UPDATE reminders SET reminder_type = $1, next_reminder_date = $2, status = 'active' WHERE pledge_id = $3`,
          [reminderFrequency, nextReminderDate, pledgeId]
        );
      } else {
        await client.query(
          `INSERT INTO reminders (pledge_id, user_id, group_id, reminder_type, next_reminder_date, status)
           VALUES ($1, $2, $3, $4, $5, 'active')`,
          [pledgeId, userId, groupId, reminderFrequency, nextReminderDate]
        );
      }
    } else {
      await client.query(
        `Update reminders SET status = 'inactive' WHERE pledge_id = $1`, [pledgeId]
      );
    }

    // Auto-DM: admin sends acknowledgement of pledge revision
    try {
      const adminResult = await client.query(
        `SELECT u.id, u.first_name, u.last_name FROM group_members gm
         JOIN users u ON u.id = gm.user_id
         WHERE gm.group_id = $1 AND gm.role = 'admin' LIMIT 1`,
        [groupId]
      );
      const memberResult = await client.query(
        'SELECT first_name, last_name FROM users WHERE id = $1',
        [userId]
      );
      if (adminResult.rows.length > 0 && memberResult.rows.length > 0) {
        const admin = adminResult.rows[0];
        const member = memberResult.rows[0];
        const groupResult = await client.query('SELECT name, currency FROM groups WHERE id = $1', [groupId]);
        const groupName = groupResult.rows[0]?.name || 'our group';
        const displayCurrency = pledge_currency || currency || groupResult.rows[0]?.currency || 'USD';
        const displayAmount = originalAmount ? parseFloat(originalAmount) : parseFloat(amount);
        const reviseMsg = `Dear ${member.first_name} ${member.last_name},\n\nWe acknowledge your revised pledge of ${displayCurrency} ${displayAmount.toLocaleString()} in "${groupName}". 📝\n\nThank you for keeping your commitment updated. We appreciate your continued support and transparency.\n\nHave a nice day! 😊\n\nWarm regards,\n${admin.first_name} ${admin.last_name}`;
        await client.query(
          'INSERT INTO messages (group_id, sender_id, recipient_id, content, message_type, is_read, created_at) VALUES ($1, $2, $3, $4, $5, false, NOW())',
          [groupId, admin.id, userId, reviseMsg, 'text']
        );
      }
    } catch (dmErr) { console.error('Pledge revision DM error:', dmErr.message); }

    await client.query('COMMIT');

    res.json({
      success: true,
      data: { pledge: result.rows[0] },
      message: 'Pledge revised successfully'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update pledge error:', error);
    res.status(500).json({ success: false, message: 'Error updating pledge' });
  } finally {
    client.release();
  }
};

export const markPledgeAsPaid = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { groupId, pledgeId } = req.params;
    const { amount } = req.body;

    // Check if user is admin
    const roleCheck = await client.query(
      'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, req.user.id]
    );

    if (roleCheck.rows.length === 0 || roleCheck.rows[0].role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can mark pledges as paid'
      });
    }

    await client.query('BEGIN');

    // Get pledge info
    const pledgeInfo = await client.query(
      'SELECT * FROM pledges WHERE id = $1 AND group_id = $2',
      [pledgeId, groupId]
    );

    if (pledgeInfo.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Pledge not found'
      });
    }

    const contributionAmount = amount || pledgeInfo.rows[0].amount;

    // Update pledge status
    await client.query(
      `UPDATE pledges 
       SET status = 'paid', paid_date = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [pledgeId]
    );

    // Update group's current_amount
    await client.query(
      `UPDATE groups 
       SET current_amount = current_amount + $1
       WHERE id = $2`,
      [parseFloat(contributionAmount), groupId]
    );

    // Deactivate reminders
    await client.query(
      `UPDATE reminders SET status = 'completed' WHERE pledge_id = $1`,
      [pledgeId]
    );

    await logActivity(req.user.id, groupId, ACTIVITY_TYPES.CONTRIBUTION_MADE, {
      amount: parseFloat(contributionAmount),
      pledgeId: pledgeId,
    });

    // Check for milestones
    await checkMilestones(client, groupId, 'contributed');

    // Auto-DM: admin sends thank-you note to the contributing member
    try {
      const pledgeOwner = pledgeInfo.rows[0].user_id;
      const adminResult = await client.query(
        `SELECT u.id, u.first_name, u.last_name FROM group_members gm
         JOIN users u ON u.id = gm.user_id
         WHERE gm.group_id = $1 AND gm.role = 'admin' LIMIT 1`,
        [groupId]
      );
      const memberResult = await client.query(
        'SELECT first_name, last_name FROM users WHERE id = $1',
        [pledgeOwner]
      );
      if (adminResult.rows.length > 0 && memberResult.rows.length > 0) {
        const admin = adminResult.rows[0];
        const member = memberResult.rows[0];
        const groupResult = await client.query('SELECT name, currency FROM groups WHERE id = $1', [groupId]);
        const groupName = groupResult.rows[0]?.name || 'our group';
        const pInfo = pledgeInfo.rows[0];
        const displayCurrency = pInfo.pledge_currency || groupResult.rows[0]?.currency || 'USD';
        const displayAmount = pInfo.original_amount ? parseFloat(pInfo.original_amount) : parseFloat(contributionAmount);
        const thankYouMsg = `Dear ${member.first_name} ${member.last_name},\n\nWe greatly appreciate your contribution of ${displayCurrency} ${displayAmount.toLocaleString()} to "${groupName}"! 🎉\n\nYour pledge has been marked as fulfilled. Your generosity and follow-through mean the world to us. Every contribution brings us closer to our goal and makes a lasting impact.\n\nThank you and have a nice day! 😊\n\nWarm regards,\n${admin.first_name} ${admin.last_name}`;
        await client.query(
          'INSERT INTO messages (group_id, sender_id, recipient_id, content, message_type, is_read, created_at) VALUES ($1, $2, $3, $4, $5, false, NOW())',
          [groupId, admin.id, pledgeOwner, thankYouMsg, 'text']
        );
      }
    } catch (dmErr) { console.error('Contribution thank-you DM error:', dmErr.message); }

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Contribution recorded successfully'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Mark pledge paid error:', error);
    res.status(500).json({
      success: false,
      message: 'Error recording contribution'
    });
  } finally {
    client.release();
  }
};

export const addManualContribution = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { groupId } = req.params;
    const { userId, amount, notes } = req.body;

    // Check if user is admin
    const roleCheck = await client.query(
      'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, req.user.id]
    );

    if (roleCheck.rows.length === 0 || roleCheck.rows[0].role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can add manual contributions'
      });
    }

    await client.query('BEGIN');

    // Update group's current_amount
    await client.query(
      `UPDATE groups 
       SET current_amount = current_amount + $1
       WHERE id = $2`,
      [parseFloat(amount), groupId]
    );

    // Check if it's anonymous
    const isAnonymous = userId === 'anonymous';
    const actualUserId = isAnonymous ? req.user.id : parseInt(userId);

    await logActivity(req.user.id, groupId, ACTIVITY_TYPES.MANUAL_CONTRIBUTION, {
      amount: parseFloat(amount),
      contributorId: isAnonymous ? null : actualUserId,
      notes: notes,
      isAnonymous: isAnonymous,
    });

    // Check for milestones
    await checkMilestones(client, groupId, 'contributed');

    // Auto-DM: admin sends thank-you note for manual contribution (skip anonymous)
    if (!isAnonymous) {
      try {
        const adminInfo = await client.query(
          'SELECT first_name, last_name FROM users WHERE id = $1',
          [req.user.id]
        );
        const memberResult = await client.query(
          'SELECT first_name, last_name FROM users WHERE id = $1',
          [actualUserId]
        );
        if (adminInfo.rows.length > 0 && memberResult.rows.length > 0) {
          const admin = adminInfo.rows[0];
          const member = memberResult.rows[0];
          const groupResult = await client.query('SELECT name, currency FROM groups WHERE id = $1', [groupId]);
          const groupName = groupResult.rows[0]?.name || 'our group';
          const groupCurrency = groupResult.rows[0]?.currency || 'USD';
          const thankYouMsg = `Dear ${member.first_name} ${member.last_name},\n\nWe greatly appreciate your contribution of ${groupCurrency} ${parseFloat(amount).toLocaleString()} to "${groupName}"! 🎉\n\nYour generosity and support mean the world to us. Every contribution brings us closer to our goal and makes a lasting impact.\n\nThank you and have a nice day! 😊\n\nWarm regards,\n${admin.first_name} ${admin.last_name}`;
          await client.query(
            'INSERT INTO messages (group_id, sender_id, recipient_id, content, message_type, is_read, created_at) VALUES ($1, $2, $3, $4, $5, false, NOW())',
            [groupId, req.user.id, actualUserId, thankYouMsg, 'text']
          );
        }
      } catch (dmErr) { console.error('Manual contribution thank-you DM error:', dmErr.message); }
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Manual contribution recorded successfully'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Add manual contribution error:', error);
    res.status(500).json({
      success: false,
      message: 'Error adding contribution'
    });
  } finally {
    client.release();
  }
};

export const getGroupPledges = async (req, res) => {
  try {
    const { groupId } = req.params;

    const result = await pool.query(
      `SELECT 
        p.*,
        u.first_name,
        u.last_name,
        u.email
       FROM pledges p
       INNER JOIN users u ON p.user_id = u.id
       WHERE p.group_id = $1
       ORDER BY p.pledge_date DESC`,
      [groupId]
    );

    res.json({
      success: true,
      data: { pledges: result.rows }
    });
  } catch (error) {
    console.error('Get pledges error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching pledges'
    });
  }
};

export const getUserNotificationPreferences = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM notification_preferences WHERE user_id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      // Create default preferences
      const newPrefs = await pool.query(
        `INSERT INTO notification_preferences (user_id) 
         VALUES ($1) 
         RETURNING *`,
        [req.user.id]
      );
      return res.json({
        success: true,
        data: { preferences: newPrefs.rows[0] }
      });
    }

    res.json({
      success: true,
      data: { preferences: result.rows[0] }
    });
  } catch (error) {
    console.error('Get preferences error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching preferences'
    });
  }
};

export const updateNotificationPreferences = async (req, res) => {
  try {
    const { 
      milestone_25, 
      milestone_50, 
      milestone_75, 
      milestone_100,
      pledge_notifications,
      contribution_notifications 
    } = req.body;

    const result = await pool.query(
      `INSERT INTO notification_preferences 
       (user_id, milestone_25, milestone_50, milestone_75, milestone_100, pledge_notifications, contribution_notifications)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id) 
       DO UPDATE SET 
         milestone_25 = $2,
         milestone_50 = $3,
         milestone_75 = $4,
         milestone_100 = $5,
         pledge_notifications = $6,
         contribution_notifications = $7
       RETURNING *`,
      [req.user.id, milestone_25, milestone_50, milestone_75, milestone_100, pledge_notifications, contribution_notifications]
    );

    res.json({
      success: true,
      data: { preferences: result.rows[0] },
      message: 'Preferences updated successfully'
    });
  } catch (error) {
    console.error('Update preferences error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating preferences'
    });
  }
};

// Helper function to calculate next reminder date
const calculateNextReminderDate = (frequency) => {
  const now = new Date();
  const nextDate = new Date(now);

  switch (frequency) {
    case 'daily':
      nextDate.setDate(now.getDate() + 1);
      break;
    case 'weekly':
      nextDate.setDate(now.getDate() + 7);
      break;
    case 'biweekly':
      nextDate.setDate(now.getDate() + 14);
      break;
    case 'triweekly':
      nextDate.setDate(now.getDate() + 21);
      break;
    case 'monthly':
      nextDate.setMonth(now.getMonth() + 1);
      break;
    default:
      return null;
  }

  return nextDate.toISOString().split('T')[0];
};

// Helper function to check milestones
const checkMilestones = async (client, groupId, type) => {
  try {
    const groupResult = await client.query(
      'SELECT goal_amount, current_amount, pledged_amount FROM groups WHERE id = $1',
      [groupId]
    );

    if (groupResult.rows.length === 0) return;

    const { goal_amount, current_amount, pledged_amount } = groupResult.rows[0];
    const amount = type === 'pledged' ? pledged_amount : current_amount;
    const percentage = (amount / goal_amount) * 100;

    const milestones = [25, 50, 75, 100];
    
    for (const milestone of milestones) {
      if (percentage >= milestone) {
        // Check if milestone already recorded
        const existingMilestone = await client.query(
          'SELECT * FROM milestones_reached WHERE group_id = $1 AND milestone_type = $2 AND milestone_percent = $3',
          [groupId, type, milestone]
        );

        if (existingMilestone.rows.length === 0) {
          // Record milestone
          await client.query(
            'INSERT INTO milestones_reached (group_id, milestone_type, milestone_percent) VALUES ($1, $2, $3)',
            [groupId, type, milestone]
          );

          // Log activity
          await pool.query(
            `INSERT INTO activities (user_id, group_id, activity_type, activity_data)
             SELECT user_id, $1, $2, $3
             FROM group_members
             WHERE group_id = $1
             LIMIT 1`,
            [groupId, ACTIVITY_TYPES.MILESTONE_REACHED, JSON.stringify({ milestone, type })]
          );
        }
      }
    }
  } catch (error) {
    console.error('Check milestones error:', error);
  }
};