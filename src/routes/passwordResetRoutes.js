import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import db from '../config/database.js';

const router = express.Router();

// ==========================================
// POST /api/auth/forgot-password
// Generates a reset code for the user
// ==========================================
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    // Check if user exists
    const userResult = await db.query(
      `SELECT id, email, first_name FROM users WHERE email = $1`,
      [email.toLowerCase().trim()]
    );

    // Always return success even if email not found (security: don't reveal if email exists)
    if (userResult.rows.length === 0) {
      return res.json({
        success: true,
        message: 'If an account with that email exists, a reset code has been sent.'
      });
    }

    const user = userResult.rows[0];

    // Generate 6-character alphanumeric code
    const resetCode = crypto.randomBytes(3).toString('hex').toUpperCase(); // e.g., "A1B2C3"
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    // Create password_resets table entry (or update if exists)
    // First ensure the table exists
    await db.query(`
      CREATE TABLE IF NOT EXISTS password_resets (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        email TEXT NOT NULL,
        reset_code TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Delete any existing unused codes for this email
    await db.query(
      `DELETE FROM password_resets WHERE email = $1 AND used = FALSE`,
      [email.toLowerCase().trim()]
    );

    // Insert new code
    await db.query(
      `INSERT INTO password_resets (user_id, email, reset_code, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [user.id, email.toLowerCase().trim(), resetCode, expiresAt]
    );

    // In production, you would send this code via email using SendGrid/Mailgun/etc.
    // For now, we'll log it and return it in the response for testing
    console.log(`Password reset code for ${email}: ${resetCode}`);

    res.json({
      success: true,
      message: 'If an account with that email exists, a reset code has been sent.',
      // TODO: Remove this in production — only for testing
      _devCode: resetCode
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ success: false, message: 'Failed to process request' });
  }
});

// ==========================================
// POST /api/auth/reset-password
// Verifies code and resets the password
// ==========================================
router.post('/reset-password', async (req, res) => {
  try {
    const { email, resetCode, newPassword } = req.body;

    if (!email || !resetCode || !newPassword) {
      return res.status(400).json({ success: false, message: 'Email, reset code, and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    // Find the reset code
    const codeResult = await db.query(
      `SELECT * FROM password_resets
       WHERE email = $1 AND reset_code = $2 AND used = FALSE
       ORDER BY created_at DESC LIMIT 1`,
      [email.toLowerCase().trim(), resetCode.toUpperCase().trim()]
    );

    if (codeResult.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid or expired reset code' });
    }

    const resetRecord = codeResult.rows[0];

    // Check if expired
    if (new Date(resetRecord.expires_at) < new Date()) {
      return res.status(400).json({ success: false, message: 'Reset code has expired. Please request a new one.' });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Update user password
    await db.query(
      `UPDATE users SET password = $1 WHERE email = $2`,
      [hashedPassword, email.toLowerCase().trim()]
    );

    // Mark code as used
    await db.query(
      `UPDATE password_resets SET used = TRUE WHERE id = $1`,
      [resetRecord.id]
    );

    res.json({
      success: true,
      message: 'Password has been reset successfully'
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ success: false, message: 'Failed to reset password' });
  }
});

export default router;
