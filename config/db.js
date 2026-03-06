import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const mysqlPool = mysql.createPool({
  host: process.env.MYSQL_HOST || "localhost",
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "Castrol12",
  database: process.env.MYSQL_DATABASE || "android_api",
  waitForConnections: true,
  connectionLimit: 10,
});

export default mysqlPool;
