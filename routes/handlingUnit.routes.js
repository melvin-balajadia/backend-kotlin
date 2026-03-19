import express from "express";
import asyncHandler from "../middleware/asyncHandler.js";

import {
  createHUEntries,
  getHUByTransactionId,
  getPaginatedHUEntries,
} from "../controllers/handlingUnit.controller.js";

const router = express.Router();

router.get("/hu-entry/:id", asyncHandler(getHUByTransactionId));

router.get("/paginated-hu-entry", asyncHandler(getPaginatedHUEntries));

router.post("/hu-entry", asyncHandler(createHUEntries));

export default router;
