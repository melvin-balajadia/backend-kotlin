// routes/notifications.routes.js
// ─────────────────────────────────────────────────────────────────────────────
// Follows the exact same structure as approval.routes.js and
// transactions.routes.js:
//   - ES module syntax
//   - router.use(verifyJWT) guards the whole router
//   - Every handler wrapped in catchAsync (no try/catch in routes)
//   - Named :notificationId param (consistent with :transactionId, :huId etc.)
// ─────────────────────────────────────────────────────────────────────────────

import express from "express";
import catchAsync from "../utils/catchAsync.js";
import verifyJWT from "../middleware/verifyJWT.js";

import {
  getNotifications,
  markOneRead,
  markAllRead,
  deleteNotification,
} from "../controllers/notifications.controller.js";

const router = express.Router();

// All notification routes require a valid JWT
router.use(verifyJWT);

// ── GET  /api/v1/notifications ──────────────────────────────────────────────
// Returns paginated notifications for the logged-in user.
// Query params: page, per_page, sort_by, sort_dir, search, unread_only, kind
router.get("/notifications", catchAsync(getNotifications));

// ── PATCH /api/v1/notifications/read-all ────────────────────────────────────
// Must be declared BEFORE /:notificationId so Express doesn't treat
// "read-all" as a dynamic segment.
router.patch("/notifications/read-all", catchAsync(markAllRead));

// ── PATCH /api/v1/notifications/:notificationId/read ────────────────────────
router.patch("/notifications/:notificationId/read", catchAsync(markOneRead));

// ── DELETE /api/v1/notifications/:notificationId ─────────────────────────────
router.delete("/notifications/:notificationId", catchAsync(deleteNotification));

export default router;
