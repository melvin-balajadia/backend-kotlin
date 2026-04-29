import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import hpp from "hpp";
import cookieParser from "cookie-parser";
import fs from "fs";
import path from "path";
import https from "https";
import { fileURLToPath } from "url";
import { dirname } from "path";

import db from "./config/db.js";
import logger from "./config/logger.js";
import corsOptions from "./config/corsOption.js";
import credentials from "./middleware/credentials.js";
import transactionEntriesRoutes from "./routes/transactions.routes.js";
import huEntriesRoutes from "./routes/handlingUnit.routes.js";
import itemEntriesRoutes from "./routes/items.routes.js";
import authRoutes from "./routes/auth.routes.js";

import errorHandler from "./middleware/errorHandler.js";
import verifyJWT from "./middleware/verifyJWT.js";
import { apiLimiter } from "./middleware/rateLimiter.js";
import AppError from "./utils/appError.js"; // ← added

// ─── Load Environment Variables ───────────────────────────────────────────────
dotenv.config();

const requiredEnvVars = [
  "NODE_ENV",
  "PORT_DEV",
  "PORT_TEST",
  "PORT_PROD",
  "MYSQL_HOST",
  "MYSQL_USER",
  "MYSQL_PASSWORD",
  "MYSQL_DATABASE",
  "ACCESS_TOKEN_SECRET",
  "REFRESH_TOKEN_SECRET",
];

const missingVars = requiredEnvVars.filter((key) => !process.env[key]);
if (missingVars.length > 0) {
  logger.error(
    `❌ Missing required environment variables: ${missingVars.join(", ")}`,
  );
  process.exit(1);
}

const { NODE_ENV, PORT_DEV, PORT_TEST, PORT_PROD } = process.env;

// ─── ES Module __dirname Fix ──────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Process-level Error Handlers ─────────────────────────────────────────────
process.on("uncaughtException", (err) => {
  logger.error("💥 Uncaught Exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error("💥 Unhandled Rejection:", reason);
  process.exit(1);
});

// ─── Express App ──────────────────────────────────────────────────────────────
const app = express();

// Credentials & CORS — must be first
app.use(credentials);
app.use(cors(corsOptions));

// Core Middleware
app.use(compression());
app.use(hpp());
app.use(helmet());

// Rate Limiting
app.use("/api/v1", apiLimiter);

// Body Parsers
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// HTTP Logging
app.use(
  morgan(NODE_ENV === "prod" ? "combined" : "dev", {
    stream: { write: (message) => logger.info(message.trim()) },
  }),
);

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use("/api/v1", authRoutes);
app.use(verifyJWT);
app.use("/api/v1", transactionEntriesRoutes);
app.use("/api/v1", huEntriesRoutes);
app.use("/api/v1", itemEntriesRoutes);

// ─── Health Check ─────────────────────────────────────────────────────────────  ← here
app.get("/health", async (req, res) => {
  try {
    const conn = await db.getConnection();
    conn.release();
    res.status(200).json({
      status: "ok",
      environment: NODE_ENV,
      timestamp: new Date().toISOString(),
    });
  } catch {
    res.status(503).json({ status: "error", message: "Database unreachable" });
  }
});

// ─── 404 Handler ──────────────────────────────────────────────────────────────  ← added
app.use((req, res, next) => {
  next(new AppError(`Route ${req.originalUrl} not found`, 404));
});

// ─── Global Error Handler — must be last ──────────────────────────────────────
app.use(errorHandler);

// ─── SSL Helpers ──────────────────────────────────────────────────────────────
const certPath = path.join(__dirname, "certificates");
const keyPath = path.join(certPath, "cert.key");
const certFilePath = path.join(certPath, "server.crt");
const caPath = path.join(certPath, "inter.crt");

const sslExists = () =>
  fs.existsSync(keyPath) &&
  fs.existsSync(certFilePath) &&
  fs.existsSync(caPath);

const createSSLServer = () => {
  const sslOptions = {
    key: fs.readFileSync(keyPath, "utf8"),
    cert: fs.readFileSync(certFilePath, "utf8"),
    ca: fs.readFileSync(caPath, "utf8"),
  };
  return https.createServer(sslOptions, app);
};

const startWithSSL = (port, label) => {
  if (!sslExists()) {
    logger.warn("⚠️ SSL certificates not found. Falling back to HTTP.");
    logger.info(`🚀 ${label} server running on port ${port} (HTTP)`);
    return app.listen(port);
  }
  logger.info(`🔒 ${label} server running on port ${port} (HTTPS)`);
  return createSSLServer().listen(port);
};

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
const gracefulShutdown = (server, signal) => {
  logger.info(`🛑 ${signal} received. Shutting down gracefully...`);

  const forceExit = setTimeout(() => {
    logger.error("❌ Forced shutdown after timeout.");
    process.exit(1);
  }, 10_000);

  server.close(async () => {
    clearTimeout(forceExit);
    logger.info("✅ Server closed.");
    try {
      await db.end();
      logger.info("✅ Database pool closed.");
    } catch (err) {
      logger.error("❌ Error closing database pool:", err);
    }
    process.exit(0);
  });
};

// ─── Start Server ─────────────────────────────────────────────────────────────
const startServer = async () => {
  try {
    const conn = await db.getConnection();
    logger.info("✅ Database connected successfully");
    conn.release();
  } catch (error) {
    logger.error("❌ Database connection failed:", error.message);
    process.exit(1);
  }

  let server;

  switch (NODE_ENV) {
    case "test":
      server = startWithSSL(PORT_TEST, "Test");
      break;
    case "prod":
      server = startWithSSL(PORT_PROD, "Production");
      break;
    case "dev":
    default:
      logger.info(`🚀 Development server running on port ${PORT_DEV}`);
      server = app.listen(PORT_DEV);
      break;
  }

  process.on("SIGTERM", () => gracefulShutdown(server, "SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown(server, "SIGINT"));
};

startServer();
