import mysql from "mysql2/promise";
import dotenv from "dotenv";
import logger from "./logger.js";

// ─── Pool Configuration ───────────────────────────────────────────────────────
const poolConfig = {
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: process.env.NODE_ENV === "prod" ? 20 : 10,
  queueLimit: 0, // unlimited queued requests
  connectTimeout: 10_000, // 10s to establish a connection
  idleTimeout: 60_000, // release idle connections after 60s
  enableKeepAlive: true, // prevent connections from being dropped
  keepAliveInitialDelay: 10_000,
};

// ─── Create Pool ──────────────────────────────────────────────────────────────
const db = mysql.createPool(poolConfig);

// ─── Pool Event Listeners ─────────────────────────────────────────────────────
db.on("connection", (connection) => {
  logger.info(`📦 New DB connection established — ID: ${connection.threadId}`);
});

db.on("enqueue", () => {
  logger.warn("⏳ Waiting for available DB connection in pool...");
});

// ─── Query Helper (optional but recommended) ──────────────────────────────────
// Centralizes query execution — easier to add logging, retries, or metrics later
export const query = async (sql, params) => {
  const start = Date.now();
  try {
    const [rows] = await db.execute(sql, params);
    logger.info(`✅ Query executed in ${Date.now() - start}ms`);
    return rows;
  } catch (err) {
    logger.error(`❌ Query failed: ${err.message}`);
    throw err;
  }
};

export default db;
