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
    console.log('Starting multiple pledges migration...');
    
    await client.query('BEGIN');

    // Drop the unique constraint on pledges table
    console.log('Removing unique constraint on pledges...');
    await client.query(`
      ALTER TABLE pledges 
      DROP CONSTRAINT IF EXISTS pledges_group_id_user_id_key
    `);

    // Add created_at column if it doesn't exist
    await client.query(`
      ALTER TABLE pledges 
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    `);

    await client.query('COMMIT');
    
    console.log('✓ Migration completed successfully!');
    console.log('✓ Users can now make multiple pledges per group');
    
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
    console.log('\n✓ Multiple pledges migration complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n✗ Migration error:', error);
    process.exit(1);
  });