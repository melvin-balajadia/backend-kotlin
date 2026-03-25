import express from "express";
import asyncHandler from "../middleware/asyncHandler.js";

import {
  bulkUpsertItems,
  getPaginatedItemEntries,
  getItemEntries,
  getItemsEntryById,
} from "../controllers/items.controller.js";

const router = express.Router();

router.post("/items-entry", asyncHandler(bulkUpsertItems));

router.get("/paginated-items-entry", asyncHandler(getPaginatedItemEntries));

router.get("/items-entry", asyncHandler(getItemEntries));

router.get("/items-entry/:itemsId", asyncHandler(getItemsEntryById));

export default router;
