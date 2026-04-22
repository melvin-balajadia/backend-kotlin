import logger from "../config/logger.js";

// ─── Error Handler Middleware ─────────────────────────────────────────────────
const errorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.message = err.message || "Internal Server Error";

  // ─── Structured Error Logging ───────────────────────────────────────────────
  logger.error({
    statusCode: err.statusCode,
    message: err.message,
    method: req.method,
    path: req.originalUrl,
    stack: err.stack,
  });

  // ─── Operational Errors (AppError) ─────────────────────────────────────────
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
    });
  }

  // ─── MySQL Errors ───────────────────────────────────────────────────────────
  if (err.code === "ER_DUP_ENTRY") {
    return res.status(409).json({
      success: false,
      message: "Duplicate entry. Record already exists.",
    });
  }

  if (err.code === "ER_NO_REFERENCED_ROW_2") {
    return res.status(400).json({
      success: false,
      message: "Referenced record does not exist.",
    });
  }

  if (err.code === "ER_ROW_IS_REFERENCED_2") {
    return res.status(400).json({
      success: false,
      message: "Cannot delete. Record is referenced by another entry.",
    });
  }

  if (err.code === "ER_BAD_NULL_ERROR") {
    return res.status(400).json({
      success: false,
      message: "A required field is missing or null.",
    });
  }

  if (err.code === "ER_DATA_TOO_LONG") {
    return res.status(400).json({
      success: false,
      message: "One or more fields exceed the maximum allowed length.",
    });
  }

  if (err.code === "ECONNREFUSED" || err.code === "PROTOCOL_CONNECTION_LOST") {
    return res.status(503).json({
      success: false,
      message: "Database connection lost. Please try again later.",
    });
  }

  // ─── JWT Errors ─────────────────────────────────────────────────────────────
  if (err.name === "JsonWebTokenError") {
    return res.status(401).json({
      success: false,
      message: "Invalid token. Please log in again.",
    });
  }

  if (err.name === "TokenExpiredError") {
    return res.status(401).json({
      success: false,
      message: "Token has expired. Please log in again.",
    });
  }

  if (err.name === "NotBeforeError") {
    return res.status(401).json({
      success: false,
      message: "Token not yet active.",
    });
  }

  // ─── Syntax Error (malformed JSON body) ────────────────────────────────────
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({
      success: false,
      message: "Invalid JSON in request body.",
    });
  }

  // ─── Unknown Errors ─────────────────────────────────────────────────────────
  // prod — hide internals from client
  if (process.env.NODE_ENV === "prod") {
    return res.status(500).json({
      success: false,
      message: "Something went wrong. Please try again later.",
    });
  }

  // dev/test — expose full details for debugging
  return res.status(500).json({
    success: false,
    message: err.message,
    stack: err.stack,
  });
};

export default errorHandler;
