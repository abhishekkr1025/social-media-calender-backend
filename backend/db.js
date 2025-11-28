// db.js
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || 'Cadet@0972',
  database: process.env.DB_NAME || 'socialmedia_app',
  waitForConnections: true,
  connectionLimit: 10,
});

export default pool;
