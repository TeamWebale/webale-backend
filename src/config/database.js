import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;

// Configure SSL for production (Render requires SSL)
const isProduction = process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false
});

export const testConnection = async () => {
  try {
    const client = await pool.connect();
    console.log('✅ Database connected successfully');
    client.release();
  } catch (error) {
    console.error('❌ Database connection error:', error.message);
    throw error;
  }
};

export default pool;
