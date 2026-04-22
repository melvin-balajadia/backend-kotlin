import rateLimit from "express-rate-limit";
import logger from "../config/logger.js";

// ─── Rate Limit Handler ───────────────────────────────────────────────────────
const rateLimitHandler = (req, res, next, options) => {
  logger.warn({
    message: "Rate limit exceeded",
    ip: req.ip,
    method: req.method,
    path: req.originalUrl,
  });

  res.status(options.statusCode).json({
    success: false,
    message: options.message,
  });
};

// ─── API Limiter (General) ────────────────────────────────────────────────────
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  standardHeaders: true, // returns RateLimit headers in response
  legacyHeaders: false, // disables X-RateLimit headers (deprecated)
  message: "Too many requests, please try again later.",
  handler: rateLimitHandler,
});

// ─── Auth Limiter (Stricter — for login/refresh routes) ───────────────────────
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // only 10 attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many login attempts, please try again later.",
  handler: rateLimitHandler,
});
