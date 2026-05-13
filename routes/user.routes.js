import express from "express";
import catchAsync from "../utils/catchAsync.js";
import verifyJWT from "../middleware/verifyJWT.js";
import checkPermission from "../middleware/checkPermission.js";

import {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  setUserStatus,
  forceResetPassword,
  getPaginatedUsers,
} from "../controllers/user.controller.js";

const router = express.Router();

// All user-management routes require authentication
router.use(verifyJWT);

// ─── User CRUD ────────────────────────────────────────────────────────────────
router.get("/users", checkPermission("user:view"), catchAsync(getUsers));

router.get("/users/:id", checkPermission("user:view"), catchAsync(getUserById));

router.post("/users", checkPermission("user:create"), catchAsync(createUser));

router.patch(
  "/users/:id",
  checkPermission("user:edit"),
  catchAsync(updateUser),
);

// ─── User Status (activate / deactivate) ─────────────────────────────────────
router.patch(
  "/users/:id/status",
  checkPermission("user:deactivate"),
  catchAsync(setUserStatus),
);

// ─── Admin password reset ─────────────────────────────────────────────────────
router.patch(
  "/users/:id/force-reset",
  checkPermission("user:reset_password"),
  catchAsync(forceResetPassword),
);

router.get(
  "/paginated-users",
  checkPermission("user:view"),
  catchAsync(getPaginatedUsers),
);

export default router;
