import express from "express";
import catchAsync from "../utils/catchAsync.js";
import verifyJWT from "../middleware/verifyJWT.js";
import { resetPasswordLimiter } from "../middleware/rateLimiter.js";
import { deviceLoggerMiddleware } from "../middleware/deviceLogger.js";

import {
  loginFunction,
  refreshFunction,
  logoutFunction,
  resetPassword,
} from "../controllers/auth.conroller.js";

const router = express.Router();

router.post("/auth-login", deviceLoggerMiddleware, catchAsync(loginFunction));
router.get("/auth-refresh", catchAsync(refreshFunction));
router.post("/auth-logout", catchAsync(logoutFunction));
router.patch(
  "/auth-reset",
  verifyJWT,
  resetPasswordLimiter,
  catchAsync(resetPassword),
);

export default router;
