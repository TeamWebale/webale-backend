import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../config/database.js';
import { Resend } from 'resend';
const resend = new Resend(process.env.RESEND_API_KEY);

// ── OTP email helper ──────────────────────────────────────────────
const sendOtpEmail = async (email, firstName, otp) => {
  await resend.emails.send({
    from: 'Webale <noreply@webale.net>',
    to: email,
    subject: 'Your Webale verification code',
    html: `
      <div style="font-family:'Segoe UI',sans-serif;max-width:480px;margin:0 auto;background:#0D1B2E;padding:32px;border-radius:16px;">
        <div style="text-align:center;margin-bottom:24px;">
          <h1 style="color:#00E5CC;font-size:28px;margin:0;">Webale!</h1>
          <p style="color:#FFB800;margin:4px 0 0;font-size:13px;">Private Group Fundraising</p>
        </div>
        <p style="color:#ffffff;font-size:16px;">Hi ${firstName || 'there'},</p>
        <p style="color:rgba(255,255,255,0.7);font-size:14px;">Your verification code is:</p>
        <div style="text-align:center;margin:24px 0;">
          <span style="font-size:42px;font-weight:800;letter-spacing:12px;color:#00E5CC;background:rgba(0,229,204,0.1);padding:16px 24px;border-radius:12px;display:inline-block;">
            ${otp}
          </span>
        </div>
        <p style="color:rgba(255,255,255,0.5);font-size:12px;text-align:center;">
          This code expires in <strong style="color:#FFB800;">15 minutes</strong>.<br>
          If you did not create a Webale account, ignore this email.
        </p>
        <hr style="border:none;border-top:1px solid rgba(255,255,255,0.1);margin:24px 0;">
        <p style="color:rgba(255,255,255,0.3);font-size:11px;text-align:center;">
          © 2026 Landfolks Aitech (U) Ltd · theteam@webale.net
        </p>
      </div>
    `,
  });
};

// ── Register new user ─────────────────────────────────────────────
export const register = async (req, res) => {
  try {
    const { email, password, firstName, lastName, country } = req.body;

    const existingUser = await db.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ success: false, message: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const avatars = ['😀','😎','🤓','😊','🥳','😇','🤩','😏','🧑‍💼','👨‍🎨','👩‍💻','🧑‍🚀','🦸','🧙','👑','🌟'];
    const randomAvatar = avatars[Math.floor(Math.random() * avatars.length)];

    const result = await db.query(
      `INSERT INTO users (email, password, first_name, last_name, country, avatar_url, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING *`,
      [email, hashedPassword, firstName, lastName, country || null, randomAvatar]
    );

    const user = result.rows[0];

    // Generate OTP and save to DB
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const exp = new Date(Date.now() + 15 * 60 * 1000);
    await db.query(
      'UPDATE users SET otp_code = $1, otp_expires_at = $2 WHERE id = $3',
      [otp, exp, user.id]
    );

    // Send OTP email
    await sendOtpEmail(user.email, user.first_name, otp);

    res.status(201).json({
      success: true,
      message: 'OTP sent',
      data: { email: user.email, requiresVerification: true }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ success: false, message: 'Registration failed' });
  }
};

// ── Login ─────────────────────────────────────────────────────────
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    await db.query('UPDATE users SET last_active = NOW() WHERE id = $1', [user.id]);

    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          country: user.country,
          avatar_url: user.avatar_url,
          avatar_type: user.avatar_type || 'emoji',
          avatar: user.avatar_url,
          phone: user.phone,
          bio: user.bio,
          created_at: user.created_at
        }
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
};

// ── Get current user ──────────────────────────────────────────────
export const getMe = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, email, first_name, last_name, country, bio, phone,
              date_of_birth, avatar_url, avatar_type, social_links,
              profile_public, created_at, last_active
       FROM users WHERE id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const user = result.rows[0];
    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          country: user.country,
          bio: user.bio,
          phone: user.phone,
          date_of_birth: user.date_of_birth,
          avatar_url: user.avatar_url,
          avatar_type: user.avatar_type,
          social_links: user.social_links || {},
          profile_public: user.profile_public,
          created_at: user.created_at,
          last_active: user.last_active
        }
      }
    });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ success: false, message: 'Failed to get user data' });
  }
};

// ── Update profile ────────────────────────────────────────────────
export const updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      firstName, lastName, country, bio, phone,
      dateOfBirth, avatarUrl, avatarType,
      socialLinks, profilePublic
    } = req.body;

    const result = await db.query(
      `UPDATE users SET
         first_name = COALESCE($1, first_name),
         last_name = COALESCE($2, last_name),
         country = COALESCE($3, country),
         bio = $4,
         phone = $5,
         date_of_birth = $6,
         avatar_url = $7,
         avatar_type = COALESCE($8, 'initials'),
         social_links = COALESCE($9, '{}'),
         profile_public = COALESCE($10, true),
         updated_at = NOW()
       WHERE id = $11
       RETURNING id, email, first_name, last_name, country, bio, phone,
                 date_of_birth, avatar_url, avatar_type, social_links, profile_public`,
      [
        firstName, lastName, country, bio || null, phone || null,
        dateOfBirth || null, avatarUrl || null, avatarType,
        JSON.stringify(socialLinks || {}), profilePublic, userId
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: { user: result.rows[0] }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ success: false, message: 'Failed to update profile' });
  }
};

// ── Change password ───────────────────────────────────────────────
export const changePassword = async (req, res) => {
  try {
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;

    const userResult = await db.query('SELECT password FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const isMatch = await bcrypt.compare(currentPassword, userResult.rows[0].password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.query(
      'UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2',
      [hashedPassword, userId]
    );

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ success: false, message: 'Failed to change password' });
  }
};

// ── Get user profile by ID ────────────────────────────────────────
export const getUserProfile = async (req, res) => {
  try {
    const { userId } = req.params;
    const requesterId = req.user.id;

    const result = await db.query(
      `SELECT id, first_name, last_name, country, bio, avatar_url, avatar_type,
              social_links, profile_public, created_at
       FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const user = result.rows[0];

    if (!user.profile_public && user.id !== requesterId) {
      return res.json({
        success: true,
        data: {
          user: {
            id: user.id,
            first_name: user.first_name,
            last_name: user.last_name,
            country: user.country,
            avatar_url: user.avatar_url,
            avatar_type: user.avatar_type,
            created_at: user.created_at,
            is_private: true
          }
        }
      });
    }

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          first_name: user.first_name,
          last_name: user.last_name,
          country: user.country,
          bio: user.bio,
          avatar_url: user.avatar_url,
          avatar_type: user.avatar_type,
          social_links: user.social_links || {},
          created_at: user.created_at,
          is_private: false
        }
      }
    });
  } catch (error) {
    console.error('Get user profile error:', error);
    res.status(500).json({ success: false, message: 'Failed to get user profile' });
  }
};

// ── Send OTP ──────────────────────────────────────────────────────
export const sendOtp = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email required' });

    const userRes = await db.query('SELECT id, first_name FROM users WHERE email = $1', [email]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const user = userRes.rows[0];
    const otp  = Math.floor(100000 + Math.random() * 900000).toString();
    const exp  = new Date(Date.now() + 15 * 60 * 1000);

    await db.query(
      'UPDATE users SET otp_code = $1, otp_expires_at = $2 WHERE id = $3',
      [otp, exp, user.id]
    );

    await sendOtpEmail(email, user.first_name, otp);

    res.json({ success: true, message: 'OTP sent to ' + email });
  } catch (error) {
    console.error('sendOtp error:', error);
    res.status(500).json({ success: false, message: 'Failed to send OTP' });
  }
};

// ── Verify OTP ────────────────────────────────────────────────────
export const verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Email and OTP required' });
    }

    const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const user = result.rows[0];

    if (!user.otp_code || user.otp_code !== otp) {
      return res.status(400).json({ success: false, message: 'Invalid verification code' });
    }

    if (new Date() > new Date(user.otp_expires_at)) {
      return res.status(400).json({ success: false, message: 'Code expired — request a new one' });
    }

    await db.query(
      'UPDATE users SET is_verified = true, otp_code = NULL, otp_expires_at = NULL WHERE id = $1',
      [user.id]
    );

    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      message: 'Email verified successfully',
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          country: user.country,
          avatar_url: user.avatar_url,
          avatar_type: user.avatar_type,
          created_at: user.created_at,
          is_verified: true,
        }
      }
    });
  } catch (error) {
    console.error('verifyOtp error:', error);
    res.status(500).json({ success: false, message: 'Verification failed' });
  }
};
