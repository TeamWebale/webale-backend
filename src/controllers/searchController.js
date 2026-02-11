import pool from '../config/database.js';

export const searchInGroup = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { query, type = 'all' } = req.query;

    if (!query || query.trim().length < 2) {
      return res.status(400).json({ 
        success: false, 
        message: 'Search query must be at least 2 characters' 
      });
    }

    const searchTerm = `%${query.toLowerCase()}%`;
    const results = {};

    // Search members
    if (type === 'all' || type === 'members') {
      const membersResult = await pool.query(
        `SELECT 
          u.id,
          u.first_name,
          u.last_name,
          u.email,
          u.country,
          gm.role
         FROM group_members gm
         INNER JOIN users u ON gm.user_id = u.id
         WHERE gm.group_id = $1 
           AND (LOWER(u.first_name) LIKE $2 
             OR LOWER(u.last_name) LIKE $2 
             OR LOWER(u.email) LIKE $2)
         LIMIT 20`,
        [groupId, searchTerm]
      );
      results.members = membersResult.rows;
    }

    // Search pledges
    if (type === 'all' || type === 'pledges') {
      const pledgesResult = await pool.query(
        `SELECT 
          p.*,
          u.first_name,
          u.last_name
         FROM pledges p
         INNER JOIN users u ON p.user_id = u.id
         WHERE p.group_id = $1
           AND (LOWER(u.first_name) LIKE $2 
             OR LOWER(u.last_name) LIKE $2)
         ORDER BY p.pledge_date DESC
         LIMIT 20`,
        [groupId, searchTerm]
      );
      results.pledges = pledgesResult.rows;
    }

    // Search comments
    if (type === 'all' || type === 'comments') {
      const commentsResult = await pool.query(
        `SELECT 
          c.*,
          u.first_name,
          u.last_name
         FROM comments c
         INNER JOIN users u ON c.user_id = u.id
         WHERE c.group_id = $1
           AND LOWER(c.comment_text) LIKE $2
         ORDER BY c.created_at DESC
         LIMIT 20`,
        [groupId, searchTerm]
      );
      results.comments = commentsResult.rows;
    }

    // Search activities
    if (type === 'all' || type === 'activities') {
      const activitiesResult = await pool.query(
        `SELECT 
          a.*,
          u.first_name,
          u.last_name
         FROM activities a
         INNER JOIN users u ON a.user_id = u.id
         WHERE a.group_id = $1
         ORDER BY a.created_at DESC
         LIMIT 20`,
        [groupId]
      );
      results.activities = activitiesResult.rows;
    }

    res.json({
      success: true,
      data: results,
      query: query
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ success: false, message: 'Error performing search' });
  }
};

export const globalSearch = async (req, res) => {
  try {
    const { query } = req.query;
    const userId = req.user.id;

    if (!query || query.trim().length < 2) {
      return res.status(400).json({ 
        success: false, 
        message: 'Search query must be at least 2 characters' 
      });
    }

    const searchTerm = `%${query.toLowerCase()}%`;

    // Search user's groups
    const groupsResult = await pool.query(
      `SELECT 
        g.*,
        gm.role
       FROM groups g
       INNER JOIN group_members gm ON g.id = gm.group_id
       WHERE gm.user_id = $1
         AND (LOWER(g.name) LIKE $2 OR LOWER(g.description) LIKE $2)
       ORDER BY g.created_at DESC
       LIMIT 10`,
      [userId, searchTerm]
    );

    res.json({
      success: true,
      data: {
        groups: groupsResult.rows
      },
      query: query
    });
  } catch (error) {
    console.error('Global search error:', error);
    res.status(500).json({ success: false, message: 'Error performing search' });
  }
};