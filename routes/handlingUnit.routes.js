import express from "express";
import catchAsync from "../utils/catchAsync.js";

import {
  createHUEntries,
  getHUByTransactionId,
  getPaginatedHUEntries,
  updateHUEntry,
} from "../controllers/handlingUnit.controller.js";

const router = express.Router();

router.get("/hu-entry/:id", catchAsync(getHUByTransactionId));

router.put("/hu-entry/:huId", catchAsync(updateHUEntry));

router.get("/paginated-hu-entry", catchAsync(getPaginatedHUEntries));

router.post("/hu-entry", catchAsync(createHUEntries));

export default router;
