const pg = require('pg');
const Pool = pg.Pool;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function setup() {
  try {
    console.log('Creating tables...');
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY, 
        email VARCHAR(255) UNIQUE NOT NULL, 
        password VARCHAR(255) NOT NULL, 
        first_name VARCHAR(100), 
        last_name VARCHAR(100), 
        phone VARCHAR(50), 
        country VARCHAR(10), 
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Users table created');
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS groups (
        id SERIAL PRIMARY KEY, 
        name VARCHAR(255) NOT NULL, 
        description TEXT, 
        goal_amount DECIMAL(15,2) DEFAULT 0, 
        current_amount DECIMAL(15,2) DEFAULT 0, 
        pledged_amount DECIMAL(15,2) DEFAULT 0, 
        currency VARCHAR(10) DEFAULT 'USD', 
        deadline DATE, 
        status VARCHAR(50) DEFAULT 'active', 
        invite_code VARCHAR(50) UNIQUE, 
        created_by INTEGER, 
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Groups table created');
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS group_members (
        id SERIAL PRIMARY KEY, 
        group_id INTEGER, 
        user_id INTEGER, 
        role VARCHAR(50) DEFAULT 'member', 
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Group members table created');
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pledges (
        id SERIAL PRIMARY KEY, 
        group_id INTEGER, 
        user_id INTEGER, 
        amount DECIMAL(15,2) NOT NULL, 
        amount_paid DECIMAL(15,2) DEFAULT 0, 
        status VARCHAR(50) DEFAULT 'pending', 
        is_anonymous BOOLEAN DEFAULT FALSE, 
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Pledges table created');
    
    console.log('All tables created successfully!');
    pool.end();
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    pool.end();
    process.exit(1);
  }
}

setup();