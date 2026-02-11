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
    console.log('Starting Phase 4 migration...');
    
    await client.query('BEGIN');

    // Add category and visibility to groups
    console.log('Updating groups table...');
    await client.query(`
      ALTER TABLE groups 
      ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'general',
      ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS template_type VARCHAR(50)
    `);

    // Create sub_goals table
    console.log('Creating sub_goals table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS sub_goals (
        id SERIAL PRIMARY KEY,
        group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
        title VARCHAR(200) NOT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        current_amount DECIMAL(10, 2) DEFAULT 0,
        position INTEGER DEFAULT 0,
        is_completed BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create recurring_pledges table
    console.log('Creating recurring_pledges table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS recurring_pledges (
        id SERIAL PRIMARY KEY,
        group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        amount DECIMAL(10, 2) NOT NULL,
        frequency VARCHAR(20) NOT NULL,
        currency VARCHAR(3) DEFAULT 'USD',
        start_date DATE NOT NULL,
        end_date DATE,
        next_charge_date DATE,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create payments table
    console.log('Creating payments table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        pledge_id INTEGER REFERENCES pledges(id) ON DELETE SET NULL,
        amount DECIMAL(10, 2) NOT NULL,
        currency VARCHAR(3) DEFAULT 'USD',
        payment_method VARCHAR(50),
        payment_provider VARCHAR(50),
        transaction_id VARCHAR(255) UNIQUE,
        status VARCHAR(20) DEFAULT 'pending',
        receipt_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create email_queue table
    console.log('Creating email_queue table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_queue (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
        email_type VARCHAR(50) NOT NULL,
        subject VARCHAR(255) NOT NULL,
        body TEXT NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        sent_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create analytics_snapshots table
    console.log('Creating analytics_snapshots table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS analytics_snapshots (
        id SERIAL PRIMARY KEY,
        group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
        snapshot_date DATE NOT NULL,
        total_pledged DECIMAL(10, 2) DEFAULT 0,
        total_contributed DECIMAL(10, 2) DEFAULT 0,
        member_count INTEGER DEFAULT 0,
        active_pledges INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(group_id, snapshot_date)
      )
    `);

    // Add theme preference to users
    console.log('Adding theme preference to users...');
    await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS theme_preference VARCHAR(20) DEFAULT 'light'
    `);

    // Create indexes
    console.log('Creating indexes...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sub_goals_group ON sub_goals(group_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_recurring_pledges_user ON recurring_pledges(user_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_recurring_pledges_next_charge ON recurring_pledges(next_charge_date)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_payments_group ON payments(group_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_payments_transaction ON payments(transaction_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_email_queue_status ON email_queue(status)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_analytics_snapshots_group_date ON analytics_snapshots(group_id, snapshot_date)
    `);

    await client.query('COMMIT');
    
    console.log('✓ Migration completed successfully!');
    console.log('✓ Created sub_goals table');
    console.log('✓ Created recurring_pledges table');
    console.log('✓ Created payments table');
    console.log('✓ Created email_queue table');
    console.log('✓ Created analytics_snapshots table');
    console.log('✓ Added category, visibility, template to groups');
    console.log('✓ Added theme preference to users');
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
    console.log('\n✓ Phase 4 database migration complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n✗ Migration error:', error);
    process.exit(1);
  });