import express from "express";
import asyncHandler from "../middleware/asyncHandler.js";

import {
  createTransactionEntries,
  getTransactionEntries,
  getPaginatedTransactionEntries,
  getTransactionEntryById,
} from "../controllers/transactions.controller.js";

const router = express.Router();

router.post("/transaction-entry", asyncHandler(createTransactionEntries));

router.get("/transaction-entry", asyncHandler(getTransactionEntries));

router.get(
  "/paginated-transaction-entry",
  asyncHandler(getPaginatedTransactionEntries),
);

router.get(
  "/transaction-entry/:transactionId",
  asyncHandler(getTransactionEntryById),
);

export default router;
