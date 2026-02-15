import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function setup() {
  try {
    console.log('Adding last_active column to users...');
    
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    `);
    console.log('Added last_active to users');
    
    console.log('Fix completed successfully!');
    pool.end();
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    pool.end();
    process.exit(1);
  }
}

setup();