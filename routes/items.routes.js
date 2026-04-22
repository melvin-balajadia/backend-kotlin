import express from "express";
import catchAsync from "../utils/catchAsync.js";

import {
  bulkUpsertItems,
  getPaginatedItemEntries,
  getItemEntries,
  getItemsEntryById,
} from "../controllers/items.controller.js";

const router = express.Router();

router.post("/items-entry", catchAsync(bulkUpsertItems));

router.get("/paginated-items-entry", catchAsync(getPaginatedItemEntries));

router.get("/items-entry", catchAsync(getItemEntries));

router.get("/items-entry/:itemsId", catchAsync(getItemsEntryById));

export default router;
