import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function setup() {
  try {
    console.log('🚀 Webale Database Setup - Adding all required columns and tables...\n');

    // ==================== USERS TABLE ====================
    console.log('👤 Updating users table...');
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_type VARCHAR(50) DEFAULT 'initials';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_color VARCHAR(20);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS social_links TEXT DEFAULT '{}';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_public BOOLEAN DEFAULT TRUE;
    `);
    console.log('  ✅ Users table updated');

    // ==================== GROUPS TABLE ====================
    console.log('👥 Updating groups table...');
    await pool.query(`
      ALTER TABLE groups ADD COLUMN IF NOT EXISTS last_interaction TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE groups ADD COLUMN IF NOT EXISTS category VARCHAR(100);
      ALTER TABLE groups ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT TRUE;
      ALTER TABLE groups ADD COLUMN IF NOT EXISTS template_type VARCHAR(100);
      ALTER TABLE groups ADD COLUMN IF NOT EXISTS comments_enabled BOOLEAN DEFAULT TRUE;
    `);
    console.log('  ✅ Groups table updated');

    // ==================== PLEDGES TABLE ====================
    console.log('💰 Updating pledges table...');
    await pool.query(`
      ALTER TABLE pledges ADD COLUMN IF NOT EXISTS recorded_by INTEGER;
      ALTER TABLE pledges ADD COLUMN IF NOT EXISTS fulfillment_date DATE;
      ALTER TABLE pledges ADD COLUMN IF NOT EXISTS reminder_frequency VARCHAR(50) DEFAULT 'none';
      ALTER TABLE pledges ADD COLUMN IF NOT EXISTS pledge_currency VARCHAR(10) DEFAULT 'USD';
      ALTER TABLE pledges ADD COLUMN IF NOT EXISTS original_amount DECIMAL(15,2);
      ALTER TABLE pledges ADD COLUMN IF NOT EXISTS pledge_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE pledges ADD COLUMN IF NOT EXISTS paid_date TIMESTAMP;
    `);
    console.log('  ✅ Pledges table updated');

    // ==================== ACTIVITIES TABLE ====================
    console.log('📈 Updating activities table...');
    await pool.query(`
      ALTER TABLE activities ADD COLUMN IF NOT EXISTS activity_data TEXT;
    `);
    console.log('  ✅ Activities table updated');

    // ==================== SUB_GOALS TABLE ====================
    console.log('🎯 Updating sub_goals table...');
    await pool.query(`
      ALTER TABLE sub_goals ADD COLUMN IF NOT EXISTS title VARCHAR(255);
      ALTER TABLE sub_goals ADD COLUMN IF NOT EXISTS created_by INTEGER;
      ALTER TABLE sub_goals ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE sub_goals ALTER COLUMN name DROP NOT NULL;
    `);
    console.log('  ✅ Sub_goals table updated');

    // ==================== COMMENTS TABLE ====================
    console.log('💬 Updating comments table...');
    await pool.query(`
      ALTER TABLE comments ADD COLUMN IF NOT EXISTS comment_text TEXT;
      ALTER TABLE comments ADD COLUMN IF NOT EXISTS likes_count INTEGER DEFAULT 0;
      ALTER TABLE comments ADD COLUMN IF NOT EXISTS replies_count INTEGER DEFAULT 0;
    `);
    console.log('  ✅ Comments table updated');

    // ==================== REMINDERS TABLE ====================
    console.log('🔔 Creating reminders table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reminders (
        id SERIAL PRIMARY KEY,
        pledge_id INTEGER,
        user_id INTEGER,
        group_id INTEGER,
        frequency VARCHAR(50) DEFAULT 'none',
        next_reminder DATE,
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('  ✅ Reminders table ready');

    // ==================== RECURRING PLEDGES TABLE ====================
    console.log('🔄 Creating recurring_pledges table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS recurring_pledges (
        id SERIAL PRIMARY KEY,
        group_id INTEGER,
        user_id INTEGER,
        amount DECIMAL(15,2) NOT NULL,
        currency VARCHAR(10) DEFAULT 'USD',
        frequency VARCHAR(50) NOT NULL,
        start_date DATE,
        end_date DATE,
        next_due_date DATE,
        notes TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('  ✅ Recurring pledges table ready');

    // ==================== AUDIT LOGS TABLE ====================
    console.log('📋 Creating audit_logs table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        group_id INTEGER,
        actor_id INTEGER,
        action_type VARCHAR(100),
        target_type VARCHAR(50),
        target_id INTEGER,
        description TEXT,
        details TEXT,
        ip_address VARCHAR(50),
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('  ✅ Audit logs table ready');

    // ==================== INVITATIONS TABLE ====================
    console.log('📧 Creating invitations table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS invitations (
        id SERIAL PRIMARY KEY,
        group_id INTEGER,
        email VARCHAR(255),
        token VARCHAR(255) UNIQUE,
        invited_by INTEGER,
        status VARCHAR(50) DEFAULT 'pending',
        expires_at TIMESTAMP,
        accepted_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('  ✅ Invitations table ready');

    // ==================== BLOCKED USERS TABLE ====================
    console.log('🚫 Creating blocked_users table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS blocked_users (
        id SERIAL PRIMARY KEY,
        group_id INTEGER,
        user_id INTEGER,
        blocked_by INTEGER,
        reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('  ✅ Blocked users table ready');

    // ==================== COMMENT LIKES TABLE ====================
    console.log('❤️ Creating comment_likes table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS comment_likes (
        id SERIAL PRIMARY KEY,
        comment_id INTEGER,
        user_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(comment_id, user_id)
      );
    `);
    console.log('  ✅ Comment likes table ready');

    // ==================== MESSAGES TABLE ====================
    console.log('💬 Creating messages table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        group_id INTEGER,
        sender_id INTEGER,
        recipient_id INTEGER,
        content TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('  ✅ Messages table ready');

    console.log('\n🎉 Database setup completed successfully!');
    console.log('All tables and columns are up to date.\n');

    pool.end();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    pool.end();
    process.exit(1);
  }
}

setup();
