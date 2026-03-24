import express from "express";
import asyncHandler from "../middleware/asyncHandler.js";

import {
  bulkUpsertItems,
  getPaginatedItemEntries,
} from "../controllers/items.controller.js";

const router = express.Router();

router.post("/items-entry", asyncHandler(bulkUpsertItems));

router.get("/paginated-items-entry", asyncHandler(getPaginatedItemEntries));

export default router;
