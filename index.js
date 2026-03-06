import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import hpp from "hpp";

import db from "./config/db.js";
import logger from "./config/logger.js";
import productionRoutes from "./routes/production.routes.js";
import errorHandler from "./middleware/errorHandler.js";
import { apiLimiter } from "./middleware/rateLimiter.js";

dotenv.config();

const app = express();

// Core Middleware
app.use(cors());
app.use(compression());
app.use(hpp());

// Security Middleware
app.use(helmet());

// Rate Limiting
app.use("/api/v1", apiLimiter);

// Body Parsers
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true }));

// HTTP Logging
const morganFormat = process.env.NODE_ENV === "production" ? "combined" : "dev";

app.use(
  morgan(morganFormat, {
    stream: {
      write: (message) => logger.info(message.trim()),
    },
  }),
);

// ROUTES
app.use("/api/v1", productionRoutes);

// Error Handler
app.use(errorHandler);

// Database Connection Check
const verifyDatabaseConnection = async () => {
  try {
    const conn = await db.getConnection();
    logger.info("✅ Database connected successfully");
    conn.release();
  } catch (error) {
    logger.error("❌ Database connection failed: " + error.message);
    process.exit(1);
  }
};

// Start Server
const startServer = async () => {
  const PORT = process.env.PORT || 2009;

  await verifyDatabaseConnection();

  app.listen(PORT, () => {
    logger.info(`🚀 Server running on port ${PORT}`);
  });
};

startServer();
