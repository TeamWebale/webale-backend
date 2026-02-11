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
    console.log('Starting pledge system migration...');
    
    await client.query('BEGIN');

    // Add pledged_amount to groups table
    console.log('Adding pledged_amount column to groups...');
    await client.query(`
      ALTER TABLE groups 
      ADD COLUMN IF NOT EXISTS pledged_amount DECIMAL(10, 2) DEFAULT 0
    `);

    // Create pledges table
    console.log('Creating pledges table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS pledges (
        id SERIAL PRIMARY KEY,
        group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        amount DECIMAL(10, 2) NOT NULL,
        status VARCHAR(50) DEFAULT 'pledged',
        pledge_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        paid_date TIMESTAMP,
        recorded_by INTEGER REFERENCES users(id),
        notes TEXT,
        UNIQUE(group_id, user_id)
      )
    `);

    // Create notification_preferences table
    console.log('Creating notification_preferences table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS notification_preferences (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        milestone_25 BOOLEAN DEFAULT true,
        milestone_50 BOOLEAN DEFAULT true,
        milestone_75 BOOLEAN DEFAULT true,
        milestone_100 BOOLEAN DEFAULT true,
        pledge_notifications BOOLEAN DEFAULT true,
        contribution_notifications BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create milestones_reached table
    console.log('Creating milestones_reached table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS milestones_reached (
        id SERIAL PRIMARY KEY,
        group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
        milestone_type VARCHAR(50) NOT NULL,
        milestone_percent INTEGER NOT NULL,
        reached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(group_id, milestone_type, milestone_percent)
      )
    `);

    // Create indexes
    console.log('Creating indexes...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pledges_group ON pledges(group_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pledges_user ON pledges(user_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pledges_status ON pledges(status)
    `);

    await client.query('COMMIT');
    
    console.log('✓ Migration completed successfully!');
    console.log('✓ Added pledged_amount column');
    console.log('✓ Created pledges table');
    console.log('✓ Created notification_preferences table');
    console.log('✓ Created milestones_reached table');
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
    console.log('\n✓ Database migration complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n✗ Migration error:', error);
    process.exit(1);
  });