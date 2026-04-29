import express from "express";
import catchAsync from "../utils/catchAsync.js";

import {
  loginFunction,
  refreshFunction,
  logoutFunction,
  resetPassword,
} from "../controllers/auth.conroller.js";

const router = express.Router();

router.post("/auth-login", catchAsync(loginFunction));
router.get("/auth-refresh", catchAsync(refreshFunction));
router.post("/auth-logout", catchAsync(logoutFunction));
router.patch("/auth-reset/:id", catchAsync(resetPassword));

export default router;
