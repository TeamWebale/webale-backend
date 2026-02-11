import pool from '../config/database.js';

export const sendMessage = async (req, res) => {
  try {
    const { recipientId, groupId, messageText } = req.body;
    const senderId = req.user.id;

    if (!messageText || !messageText.trim()) {
      return res.status(400).json({ success: false, message: 'Message text is required' });
    }

    if (!recipientId) {
      return res.status(400).json({ success: false, message: 'Recipient is required' });
    }

    // Verify both users are members of the group
    const memberCheck = await pool.query(
      `SELECT COUNT(*) as count FROM group_members 
       WHERE group_id = $1 AND user_id IN ($2, $3)`,
      [groupId, senderId, recipientId]
    );

    if (memberCheck.rows[0].count < 2) {
      return res.status(403).json({ success: false, message: 'Both users must be group members' });
    }

    const result = await pool.query(
      `INSERT INTO direct_messages (sender_id, recipient_id, group_id, message_text)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [senderId, recipientId, groupId, messageText.trim()]
    );

    res.json({
      success: true,
      data: { message: result.rows[0] },
      message: 'Message sent successfully'
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ success: false, message: 'Error sending message' });
  }
};

export const getConversation = async (req, res) => {
  try {
    const { userId, groupId } = req.params;
    const currentUserId = req.user.id;

    const result = await pool.query(
      `SELECT 
        dm.*,
        sender.first_name as sender_first_name,
        sender.last_name as sender_last_name,
        sender.country as sender_country,
        recipient.first_name as recipient_first_name,
        recipient.last_name as recipient_last_name,
        recipient.country as recipient_country
       FROM direct_messages dm
       INNER JOIN users sender ON dm.sender_id = sender.id
       INNER JOIN users recipient ON dm.recipient_id = recipient.id
       WHERE dm.group_id = $1 
         AND ((dm.sender_id = $2 AND dm.recipient_id = $3) 
           OR (dm.sender_id = $3 AND dm.recipient_id = $2))
       ORDER BY dm.created_at ASC`,
      [groupId, currentUserId, userId]
    );

    // Mark messages as read
    await pool.query(
      `UPDATE direct_messages 
       SET is_read = true 
       WHERE recipient_id = $1 AND sender_id = $2 AND group_id = $3`,
      [currentUserId, userId, groupId]
    );

    res.json({
      success: true,
      data: { messages: result.rows }
    });
  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({ success: false, message: 'Error fetching conversation' });
  }
};

export const getInbox = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT DISTINCT ON (other_user_id, group_id)
        other_user_id,
        group_id,
        group_name,
        other_user_name,
        other_user_country,
        last_message,
        last_message_time,
        unread_count
       FROM (
         SELECT 
           CASE WHEN dm.sender_id = $1 THEN dm.recipient_id ELSE dm.sender_id END as other_user_id,
           dm.group_id,
           g.name as group_name,
           CASE 
             WHEN dm.sender_id = $1 THEN recipient.first_name || ' ' || recipient.last_name
             ELSE sender.first_name || ' ' || sender.last_name
           END as other_user_name,
           CASE 
             WHEN dm.sender_id = $1 THEN recipient.country
             ELSE sender.country
           END as other_user_country,
           dm.message_text as last_message,
           dm.created_at as last_message_time,
           (SELECT COUNT(*) FROM direct_messages 
            WHERE recipient_id = $1 
              AND sender_id = CASE WHEN dm.sender_id = $1 THEN dm.recipient_id ELSE dm.sender_id END
              AND group_id = dm.group_id
              AND is_read = false) as unread_count
         FROM direct_messages dm
         INNER JOIN users sender ON dm.sender_id = sender.id
         INNER JOIN users recipient ON dm.recipient_id = recipient.id
         INNER JOIN groups g ON dm.group_id = g.id
         WHERE dm.sender_id = $1 OR dm.recipient_id = $1
         ORDER BY dm.created_at DESC
       ) sub
       ORDER BY other_user_id, group_id, last_message_time DESC`,
      [userId]
    );

    res.json({
      success: true,
      data: { conversations: result.rows }
    });
  } catch (error) {
    console.error('Get inbox error:', error);
    res.status(500).json({ success: false, message: 'Error fetching inbox' });
  }
};