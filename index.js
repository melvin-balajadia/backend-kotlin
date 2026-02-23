import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import mysqlPool from "./config/db.js";

dotenv.config();

/* ===============================
   App Configuration
================================ */
const app = express();
const PORT = process.env.PORT || 2009;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ===============================
   Utility: Async Error Wrapper
================================ */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/* ===============================
   Database Connection Check
================================ */
const verifyDatabaseConnection = async () => {
  try {
    const connection = await mysqlPool.getConnection();
    console.log("✅ Database connected successfully");
    connection.release();
  } catch (error) {
    console.error("❌ Database connection failed:", error.message);
    throw error;
  }
};

/* ===============================
   Routes
================================ */

/**
 * @route   POST /api/v1/production-data
 * @desc    Create new production data
 */
app.post(
  "/api/v1/production-data",
  asyncHandler(async (req, res) => {
    const { productionCode, netWeight, value, unit, consumeUntil } = req.body;

    // Validation
    if (!productionCode || !netWeight || !value || !unit || !consumeUntil) {
      return res
        .status(400)
        .json({ success: false, message: "All fields are required" });
    }

    const sql = `
      INSERT INTO production_data 
      (productionCode, netWeight, value, unit, consumeUntil)
      VALUES (?, ?, ?, ?, ?)
    `;

    const [result] = await mysqlPool.query(sql, [
      productionCode,
      netWeight,
      value,
      unit,
      consumeUntil,
    ]);

    res.status(201).json({
      success: true,
      message: "Data saved successfully",
      id: result.insertId,
    });
  }),
);

/**
 * @route   GET /api/v1/production-data
 * @desc    Get all production data
 */
app.get(
  "/api/v1/production-data",
  asyncHandler(async (req, res) => {
    const sql = "SELECT * FROM production_data ORDER BY id DESC";
    const [rows] = await mysqlPool.query(sql);

    res.json({
      success: true,
      count: rows.length,
      data: rows,
    });
  }),
);

/**
 * @route   GET /api/v1/production-data/:id
 * @desc    Get single production data by ID
 */
app.get(
  "/api/v1/production-data/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const sql = "SELECT * FROM production_data WHERE id = ?";
    const [rows] = await mysqlPool.query(sql, [id]);

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "Data not found",
      });
    }

    res.json({
      success: true,
      data: rows[0],
    });
  }),
);

/* ===============================
   Global Error Handler
================================ */
app.use((err, req, res, next) => {
  console.error("❌ Server Error:", err);

  res.status(500).json({
    success: false,
    message: "Internal Server Error",
  });
});

/* ===============================
   Start Server
================================ */
const startServer = async () => {
  try {
    await verifyDatabaseConnection();

    app.listen(PORT, () => {
      console.log(`🚀 API running on port ${PORT}`);
    });
  } catch (error) {
    console.error("❌ Server not started. Fix database connection.");
    process.exit(1);
  }
};

startServer();
