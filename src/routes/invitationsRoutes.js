import express from 'express';
import jwt from 'jsonwebtoken';
import db from '../config/database.js';

const router = express.Router();

// GET /api/invitations/:token/validate - NO AUTH REQUIRED
router.get('/:token/validate', async (req, res) => {
  try {
    const { token } = req.params;

    const result = await db.query(
      `SELECT i.*, g.name as group_name, g.description as group_description,
              u.first_name as inviter_first_name, u.last_name as inviter_last_name
       FROM invitations i
       LEFT JOIN groups g ON i.group_id = g.id
       LEFT JOIN users u ON i.invited_by = u.id
       WHERE i.token = $1`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Invitation not found' });
    }

    const invitation = result.rows[0];

    if (invitation.status === 'accepted') {
      return res.status(400).json({ success: false, message: 'This invitation has already been accepted' });
    }

    if (invitation.expires_at && new Date(invitation.expires_at) < new Date()) {
      return res.status(400).json({ success: false, message: 'This invitation has expired' });
    }

    res.json({
      success: true,
      data: {
        invitation: {
          id: invitation.id,
          groupId: invitation.group_id,
          groupName: invitation.group_name || 'Fundraising Group',
          groupDescription: invitation.group_description || '',
          inviterName: `${invitation.inviter_first_name || ''} ${invitation.inviter_last_name || ''}`.trim() || 'A member',
          email: invitation.email,
          status: invitation.status,
          createdAt: invitation.created_at
        }
      }
    });
  } catch (error) {
    console.error('Validate invitation error:', error);
    res.status(500).json({ success: false, message: 'Failed to validate invitation' });
  }
});

// POST /api/invitations/:token/accept - AUTH REQUIRED
router.post('/:token/accept', async (req, res) => {
  try {
    const { token } = req.params;
    const { visibilityPreference } = req.body;

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ success: false, message: 'Please log in to accept this invitation' });
    }

    let userId;
    try {
      const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
      userId = decoded.id || decoded.userId;
    } catch (e) {
      return res.status(401).json({ success: false, message: 'Invalid or expired session. Please log in again.' });
    }

    const invResult = await db.query(`SELECT * FROM invitations WHERE token = $1`, [token]);

    if (invResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Invitation not found' });
    }

    const invitation = invResult.rows[0];

    if (invitation.status === 'accepted') {
      return res.status(400).json({ success: false, message: 'This invitation has already been accepted' });
    }

    if (invitation.expires_at && new Date(invitation.expires_at) < new Date()) {
      return res.status(400).json({ success: false, message: 'This invitation has expired' });
    }

    const memberCheck = await db.query(
      `SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2`,
      [invitation.group_id, userId]
    );

    if (memberCheck.rows.length > 0) {
      await db.query(`UPDATE invitations SET status = 'accepted', accepted_at = NOW() WHERE id = $1`, [invitation.id]);
      return res.json({ success: true, message: 'You are already a member of this group', data: { groupId: invitation.group_id } });
    }

    await db.query(
      `INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES ($1, $2, 'member', NOW())`,
      [invitation.group_id, userId]
    );

    await db.query(`UPDATE invitations SET status = 'accepted', accepted_at = NOW() WHERE id = $1`, [invitation.id]);

    res.json({ success: true, message: 'Successfully joined the group!', data: { groupId: invitation.group_id } });
  } catch (error) {
    console.error('Accept invitation error:', error);
    res.status(500).json({ success: false, message: 'Failed to accept invitation' });
  }
});

export default router;
