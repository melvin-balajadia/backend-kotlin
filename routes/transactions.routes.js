import express from "express";
import catchAsync from "../utils/catchAsync.js";

import {
  createTransactionEntries,
  getTransactionEntries,
  getPaginatedTransactionEntries,
  getTransactionEntryById,
  getPaginatedTransactions,
  updateTransactionEntries,
} from "../controllers/transactions.controller.js";

const router = express.Router();

router.post("/transaction-entry", catchAsync(createTransactionEntries));

router.get("/transaction-entry", catchAsync(getTransactionEntries));

router.get(
  "/paginated-transaction-entry",
  catchAsync(getPaginatedTransactions),
);

router.get(
  "/paginated-transaction",
  catchAsync(getPaginatedTransactionEntries),
);

router.get(
  "/transaction-entry/:transactionId",
  catchAsync(getTransactionEntryById),
);

router.put(
  "/transaction-entry/:transactionId",
  catchAsync(updateTransactionEntries),
);

export default router;
