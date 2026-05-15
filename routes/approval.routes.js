// routes/approval.routes.js
import express from "express";
import catchAsync from "../utils/catchAsync.js";
import verifyJWT from "../middleware/verifyJWT.js";
import checkPermission from "../middleware/checkPermission.js";
import {
  submitTransaction,
  approveTransaction,
  rejectTransaction,
  returnTransaction,
  getApprovalLogs,
} from "../controllers/approval.controller.js";

const router = express.Router();

router.use(verifyJWT);

// ─── Approval actions ─────────────────────────────────────────────────────────
router.post(
  "/transaction-entry/:id/submit",
  catchAsync(submitTransaction),
);

router.post(
  "/transaction-entry/:id/approve",
  checkPermission("transaction:approve"),
  catchAsync(approveTransaction),
);

router.post(
  "/transaction-entry/:id/reject",
  checkPermission("transaction:approve"),
  catchAsync(rejectTransaction),
);

router.post(
  "/transaction-entry/:id/return",
  checkPermission("transaction:return"),
  catchAsync(returnTransaction),
);

// ─── Approval log (timeline data) ────────────────────────────────────────────
router.get(
  "/transaction-entry/:id/logs",
  catchAsync(getApprovalLogs),
);

export default router;
