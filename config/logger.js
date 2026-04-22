import winston from "winston";

const { combine, timestamp, json, colorize, printf, errors } = winston.format;

const NODE_ENV = process.env.NODE_ENV;

// ─── Custom Format for Development ───────────────────────────────────────────
const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  errors({ stack: true }), // logs full stack trace on errors
  printf(({ level, message, timestamp, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length
      ? JSON.stringify(meta, null, 2)
      : "";
    return `[${timestamp}] ${level}: ${stack || message} ${metaStr}`;
  }),
);

// ─── Format for Production/Test ───────────────────────────────────────────────
const prodFormat = combine(
  timestamp(),
  errors({ stack: true }), // logs full stack trace on errors
  json(),
);

// ─── Transports ───────────────────────────────────────────────────────────────
const transports = [
  // ─── Console ────────────────────────────────────────────────────────────────
  new winston.transports.Console(),

  // ─── Error Log ──────────────────────────────────────────────────────────────
  new winston.transports.File({
    filename: "logs/error.log",
    level: "error",
    maxsize: 10_485_760, // 10MB — auto-rotate when exceeded
    maxFiles: 5, // keep last 5 rotated files
  }),

  // ─── Combined Log ───────────────────────────────────────────────────────────
  new winston.transports.File({
    filename: "logs/combined.log",
    maxsize: 10_485_760, // 10MB
    maxFiles: 5,
  }),
];

// ─── Logger ───────────────────────────────────────────────────────────────────
const logger = winston.createLogger({
  level: NODE_ENV === "prod" ? "warn" : "info", // less noise in production
  format: NODE_ENV === "dev" ? devFormat : prodFormat,
  transports,
  exitOnError: false, // don't crash on handled exceptions
});

export default logger;
