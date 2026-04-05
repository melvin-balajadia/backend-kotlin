import express from "express";
import asyncHandler from "../middleware/asyncHandler.js";

import {
  createTransactionEntries,
  getTransactionEntries,
  getPaginatedTransactionEntries,
  getTransactionEntryById,
  getPaginatedTransactions,
  updateTransactionEntries,
} from "../controllers/transactions.controller.js";

const router = express.Router();

router.post("/transaction-entry", asyncHandler(createTransactionEntries));

router.get("/transaction-entry", asyncHandler(getTransactionEntries));

router.get(
  "/paginated-transaction-entry",
  asyncHandler(getPaginatedTransactions),
);

router.get(
  "/paginated-transaction",
  asyncHandler(getPaginatedTransactionEntries),
);

router.get(
  "/transaction-entry/:transactionId",
  asyncHandler(getTransactionEntryById),
);

router.put(
  "/transaction-entry/:transactionId",
  asyncHandler(updateTransactionEntries),
);

export default router;
