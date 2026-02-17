import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import db from '../config/database.js';

const router = express.Router();

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const userResult = await db.query(
      `SELECT id, email, first_name FROM users WHERE email = $1`,
      [email.toLowerCase().trim()]
    );

    if (userResult.rows.length === 0) {
      return res.json({ success: true, message: 'If an account with that email exists, a reset code has been sent.' });
    }

    const user = userResult.rows[0];
    const resetCode = crypto.randomBytes(3).toString('hex').toUpperCase();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    // Ensure table exists
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

    await db.query(`DELETE FROM password_resets WHERE email = $1 AND used = FALSE`, [email.toLowerCase().trim()]);

    await db.query(
      `INSERT INTO password_resets (user_id, email, reset_code, expires_at) VALUES ($1, $2, $3, $4)`,
      [user.id, email.toLowerCase().trim(), resetCode, expiresAt]
    );

    console.log(`Password reset code for ${email}: ${resetCode}`);

    res.json({
      success: true,
      message: 'If an account with that email exists, a reset code has been sent.',
      _devCode: resetCode
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ success: false, message: 'Failed to process request' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const { email, resetCode, newPassword } = req.body;

    if (!email || !resetCode || !newPassword) {
      return res.status(400).json({ success: false, message: 'Email, reset code, and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    const codeResult = await db.query(
      `SELECT * FROM password_resets WHERE email = $1 AND reset_code = $2 AND used = FALSE ORDER BY created_at DESC LIMIT 1`,
      [email.toLowerCase().trim(), resetCode.toUpperCase().trim()]
    );

    if (codeResult.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid or expired reset code' });
    }

    const resetRecord = codeResult.rows[0];

    if (new Date(resetRecord.expires_at) < new Date()) {
      return res.status(400).json({ success: false, message: 'Reset code has expired. Please request a new one.' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await db.query(`UPDATE users SET password = $1 WHERE email = $2`, [hashedPassword, email.toLowerCase().trim()]);
    await db.query(`UPDATE password_resets SET used = TRUE WHERE id = $1`, [resetRecord.id]);

    res.json({ success: true, message: 'Password has been reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ success: false, message: 'Failed to reset password' });
  }
});

export default router;
