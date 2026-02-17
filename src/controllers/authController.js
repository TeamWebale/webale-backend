import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../config/database.js';

// Register new user
export const register = async (req, res) => {
  try {
    const { email, password, firstName, lastName, country } = req.body;

    // Check if user exists
    const existingUser = await db.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Email already registered'
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    // Random avatar on registration
    const avatars = ['😀','😎','🤓','😊','🥳','😇','🤩','😏','🧑‍💼','👨‍🎨','👩‍💻','🧑‍🚀','🦸','🧙','👑','🌟'];
    const randomAvatar = avatars[Math.floor(Math.random() * avatars.length)];

    const result = await db.query(
      `INSERT INTO users (email, password, first_name, last_name, country, avatar_url, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING *`,
      [email, hashedPassword, firstName, lastName, country || null, randomAvatar]
    );

    const user = result.rows[0];

    // Generate token
    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          country: user.country,
          avatar: user.avatar_url,
          created_at: user.created_at
        }
      }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed'
    });
  }
};

// Login user
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user
    const result = await db.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const user = result.rows[0];

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Update last_active
    await db.query(
      'UPDATE users SET last_active = NOW() WHERE id = $1',
      [user.id]
    );

    // Generate token
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
          avatar: user.avatar_url,
          phone: user.phone,
          bio: user.bio,
          created_at: user.created_at
        }
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed'
    });
  }
};

// Get current user
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
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
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
    res.status(500).json({
      success: false,
      message: 'Failed to get user data'
    });
  }
};

// Update profile
export const updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      firstName,
      lastName,
      country,
      bio,
      phone,
      dateOfBirth,
      avatarUrl,
      avatarType,
      avatarColor,
      socialLinks,
      profilePublic
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
        firstName,
        lastName,
        country,
        bio || null,
        phone || null,
        dateOfBirth || null,
        avatarUrl || null,
        avatarType,
        JSON.stringify(socialLinks || {}),
        profilePublic,
        userId
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: { user: result.rows[0] }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile'
    });
  }
};

// Change password
export const changePassword = async (req, res) => {
  try {
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;

    // Get current user
    const userResult = await db.query(
      'SELECT password FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, userResult.rows[0].password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await db.query(
      'UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2',
      [hashedPassword, userId]
    );

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to change password'
    });
  }
};

// Get user profile by ID (for viewing other members)
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
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = result.rows[0];

    // If profile is not public and not viewing own profile, return limited info
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
    res.status(500).json({
      success: false,
      message: 'Failed to get user profile'
    });
  }
};
