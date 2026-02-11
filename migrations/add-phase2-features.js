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
    console.log('Starting Phase 2 migration...');
    
    await client.query('BEGIN');

    // Add fulfillment_date and reminder_frequency to pledges
    console.log('Updating pledges table...');
    await client.query(`
      ALTER TABLE pledges 
      ADD COLUMN IF NOT EXISTS fulfillment_date DATE,
      ADD COLUMN IF NOT EXISTS reminder_frequency VARCHAR(50) DEFAULT 'none',
      ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS pledge_currency VARCHAR(3) DEFAULT 'USD',
      ADD COLUMN IF NOT EXISTS original_amount DECIMAL(10, 2)
    `);

    // Add currency to groups
    console.log('Updating groups table...');
    await client.query(`
      ALTER TABLE groups 
      ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'USD'
    `);

    // Create donation_buttons table
    console.log('Creating donation_buttons table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS donation_buttons (
        id SERIAL PRIMARY KEY,
        group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
        amount DECIMAL(10, 2) NOT NULL,
        label VARCHAR(100),
        position INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(group_id, position)
      )
    `);

    // Create reminders table
    console.log('Creating reminders table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS reminders (
        id SERIAL PRIMARY KEY,
        pledge_id INTEGER REFERENCES pledges(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
        reminder_type VARCHAR(50) NOT NULL,
        next_reminder_date DATE,
        last_sent_date DATE,
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes
    console.log('Creating indexes...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_donation_buttons_group ON donation_buttons(group_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders(user_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_reminders_next_date ON reminders(next_reminder_date)
    `);

    await client.query('COMMIT');
    
    console.log('✓ Migration completed successfully!');
    console.log('✓ Updated pledges table with fulfillment_date, reminder_frequency, is_anonymous, pledge_currency');
    console.log('✓ Updated groups table with currency');
    console.log('✓ Created donation_buttons table');
    console.log('✓ Created reminders table');
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
    console.log('\n✓ Phase 2 database migration complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n✗ Migration error:', error);
    process.exit(1);
  });