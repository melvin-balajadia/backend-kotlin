import jwt from "jsonwebtoken";
import db from "../config/db.js";
import AppError from "../utils/appError.js";
import catchAsync from "../utils/catchAsync.js";

// ─── verifyJWT ────────────────────────────────────────────────────────────────
// Validates the Bearer token, then enriches req.user with the group_id fetched
// from the DB. This lets checkPermission() work without an extra DB query.

const verifyJWT = catchAsync(async (req, res, next) => {
  // ─── 1. Extract token ────────────────────────────────────────────────────────
  const authHeader = req.headers.authorization || req.headers.Authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return next(new AppError("Access token is required", 401));
  }

  const token = authHeader.split(" ")[1];

  if (!token) {
    return next(new AppError("Access token is missing", 401));
  }

  // ─── 2. Verify token signature ───────────────────────────────────────────────
  // jwt.verify is synchronous; errors bubble to errorHandler via catchAsync
  const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

  // ─── 3. Load group_id from DB ────────────────────────────────────────────────
  // We fetch only the columns needed for permission checks.
  // The result is attached to req.user so downstream middleware
  // (e.g. checkPermission) doesn't need to hit the DB again.
  const [rows] = await db.query(
    `SELECT user_id, user_groupid, user_status
     FROM user_records
     WHERE user_username = ?
     LIMIT 1`,
    [decoded.user_name],
  );

  const user = rows[0];

  if (!user) {
    return next(new AppError("User not found", 401));
  }

  if (user.user_status === "inactive") {
    return next(
      new AppError("Account is deactivated. Contact your administrator.", 403),
    );
  }

  // ─── 4. Attach to request ────────────────────────────────────────────────────
  req.user = {
    user_id: user.user_id,
    user_name: decoded.user_name,
    group_id: user.user_groupid, // used by checkPermission middleware
  };

  next();
});

export default verifyJWT;
