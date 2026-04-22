import jwt from "jsonwebtoken";
import AppError from "../utils/appError.js";
import catchAsync from "../utils/catchAsync.js";

const verifyJWT = catchAsync(async (req, res, next) => {
  // ─── Extract Token ───────────────────────────────────────────────────────────
  const authHeader = req.headers.authorization || req.headers.Authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return next(new AppError("Access token is required", 401));
  }

  const token = authHeader.split(" ")[1];

  if (!token) {
    return next(new AppError("Access token is missing", 401));
  }

  // ─── Verify Token ────────────────────────────────────────────────────────────
  // jwt.verify is synchronous — errors (JsonWebTokenError, TokenExpiredError)
  // are caught by catchAsync and forwarded to errorHandler automatically
  const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

  // ─── Attach User to Request ──────────────────────────────────────────────────
  req.user = {
    user_name: decoded.user_name,
  };

  next();
});

export default verifyJWT;
