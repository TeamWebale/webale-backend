import pool from '../config/database.js';

export const ACTIVITY_TYPES = {
  GROUP_CREATED: 'group_created',
  MEMBER_JOINED: 'member_joined',
  COMMENT_POSTED: 'comment_posted',
  INVITATION_SENT: 'invitation_sent',
  MILESTONE_REACHED: 'milestone_reached',
  PLEDGE_MADE: 'pledge_made',
  PLEDGE_CANCELLED: 'pledge_cancelled',
  CONTRIBUTION_MADE: 'contribution_made',
  MANUAL_CONTRIBUTION: 'manual_contribution',
};

export const logActivity = async (userId, groupId, activityType, activityData = {}) => {
  try {
    console.log('Logging activity:', { userId, groupId, activityType, activityData });
    
    const result = await pool.query(
      'INSERT INTO activities (user_id, group_id, activity_type, activity_data) VALUES ($1, $2, $3, $4) RETURNING *',
      [userId, groupId, activityType, JSON.stringify(activityData)]
    );
    
    console.log('Activity logged successfully:', result.rows[0].id);
  } catch (error) {
    console.error('Activity logging error:', error);
  }
};