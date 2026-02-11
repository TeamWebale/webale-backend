import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const runMigration = async () => {
  const client = await pool.connect();
  
  try {
    console.log('Starting Phase 3 migration...');
    
    await client.query('BEGIN');

    // Add country to users table
    console.log('Updating users table...');
    await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS country VARCHAR(2),
      ADD COLUMN IF NOT EXISTS profile_visibility VARCHAR(20) DEFAULT 'visible'
    `);

    // Create comment_replies table
    console.log('Creating comment_replies table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS comment_replies (
        id SERIAL PRIMARY KEY,
        comment_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
        reply_text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create comment_likes table
    console.log('Creating comment_likes table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS comment_likes (
        id SERIAL PRIMARY KEY,
        comment_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(comment_id, user_id)
      )
    `);

    // Create direct_messages table
    console.log('Creating direct_messages table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS direct_messages (
        id SERIAL PRIMARY KEY,
        sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        recipient_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
        message_text TEXT NOT NULL,
        is_read BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create notices table
    console.log('Creating notices table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS notices (
        id SERIAL PRIMARY KEY,
        group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(200) NOT NULL,
        content TEXT NOT NULL,
        is_pinned BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create notice_responses table
    console.log('Creating notice_responses table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS notice_responses (
        id SERIAL PRIMARY KEY,
        notice_id INTEGER REFERENCES notices(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        response_text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create media_uploads table
    console.log('Creating media_uploads table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS media_uploads (
        id SERIAL PRIMARY KEY,
        group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        comment_id INTEGER,
        message_id INTEGER,
        file_name VARCHAR(255) NOT NULL,
        file_type VARCHAR(50) NOT NULL,
        file_size INTEGER,
        file_path TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create blocked_users table
    console.log('Creating blocked_users table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS blocked_users (
        id SERIAL PRIMARY KEY,
        group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        blocked_by INTEGER REFERENCES users(id) ON DELETE CASCADE,
        reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(group_id, user_id)
      )
    `);

    // Add likes_count to comments
    console.log('Updating comments table...');
    await client.query(`
      ALTER TABLE comments 
      ADD COLUMN IF NOT EXISTS likes_count INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS replies_count INTEGER DEFAULT 0
    `);

    // Create indexes
    console.log('Creating indexes...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_comment_replies_comment ON comment_replies(comment_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_comment_likes_comment ON comment_likes(comment_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_direct_messages_sender ON direct_messages(sender_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_direct_messages_recipient ON direct_messages(recipient_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_notices_group ON notices(group_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_media_uploads_group ON media_uploads(group_id)
    `);

    await client.query('COMMIT');
    
    console.log('✓ Migration completed successfully!');
    console.log('✓ Created comment_replies table');
    console.log('✓ Created comment_likes table');
    console.log('✓ Created direct_messages table');
    console.log('✓ Created notices table');
    console.log('✓ Created notice_responses table');
    console.log('✓ Created media_uploads table');
    console.log('✓ Created blocked_users table');
    console.log('✓ Added country and visibility to users');
    console.log('✓ Created indexes');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('✗ Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
};

runMigration()
  .then(() => {
    console.log('\n✓ Phase 3 database migration complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n✗ Migration error:', error);
    process.exit(1);
  });