import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function setup() {
  try {
    console.log('Fixing notifications table...');
    
    // Add group_id column to notifications
    await pool.query(`
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS group_id INTEGER;
    `);
    console.log('Added group_id to notifications');
    
    // Add any other missing columns
    await pool.query(`
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS data TEXT;
    `);
    console.log('Added data to notifications');
    
    // Add first_name and last_name to pledges for anonymous display
    await pool.query(`
      ALTER TABLE pledges ADD COLUMN IF NOT EXISTS notes TEXT;
    `);
    console.log('Added notes to pledges');
    
    await pool.query(`
      ALTER TABLE pledges ADD COLUMN IF NOT EXISTS due_date DATE;
    `);
    console.log('Added due_date to pledges');
    
    await pool.query(`
      ALTER TABLE pledges ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP;
    `);
    console.log('Added paid_at to pledges');
    
    await pool.query(`
      ALTER TABLE pledges ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'USD';
    `);
    console.log('Added currency to pledges');
    
    // Add updated_at to groups
    await pool.query(`
      ALTER TABLE groups ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    `);
    console.log('Added updated_at to groups');
    
    console.log('All fixes completed successfully!');
    pool.end();
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    pool.end();
    process.exit(1);
  }
}

setup();