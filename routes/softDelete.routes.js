// routes/softDelete.routes.js
import express from "express";
import catchAsync from "../utils/catchAsync.js";
import verifyJWT from "../middleware/verifyJWT.js";
import checkPermission from "../middleware/checkPermission.js";
import {
  deleteTransaction,
  deleteHU,
  deleteItem,
  restoreTransaction,
  restoreHU,
  restoreItem,
  getDeletedTransactions,
} from "../controllers/softDelete.controller.js";

const router = express.Router();

router.use(verifyJWT);

// ── Soft Delete ───────────────────────────────────────────────────────────────
router.delete(
  "/transaction-entry/:id",
  checkPermission("transaction:delete"),
  catchAsync(deleteTransaction),
);

router.delete(
  "/hu-entry/:huId",
  checkPermission("transaction:delete"),
  catchAsync(deleteHU),
);

router.delete(
  "/items-entry/:itemId",
  checkPermission("transaction:delete"),
  catchAsync(deleteItem),
);

// ── Restore ───────────────────────────────────────────────────────────────────
router.patch(
  "/transaction-entry/:id/restore",
  checkPermission("transaction:restore"),
  catchAsync(restoreTransaction),
);

router.patch(
  "/hu-entry/:huId/restore",
  checkPermission("transaction:restore"),
  catchAsync(restoreHU),
);

router.patch(
  "/items-entry/:itemId/restore",
  checkPermission("transaction:restore"),
  catchAsync(restoreItem),
);

// ── Recycle Bin ───────────────────────────────────────────────────────────────
router.get(
  "/deleted/transactions",
  checkPermission("transaction:delete"),
  catchAsync(getDeletedTransactions),
);

export default router;
