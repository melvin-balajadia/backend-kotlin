import express from "express";
import catchAsync from "../utils/catchAsync.js";
import verifyJWT from "../middleware/verifyJWT.js";

import {
  createHUEntries,
  getHUByTransactionId,
  getPaginatedHUEntries,
  updateHUEntry,
  archiveHU,
} from "../controllers/handlingUnit.controller.js";

const router = express.Router();

router.use(verifyJWT);

router.get("/hu-entry/:id", catchAsync(getHUByTransactionId));

router.put("/hu-entry/:huId", catchAsync(updateHUEntry));

router.get("/paginated-hu-entry", catchAsync(getPaginatedHUEntries));

router.post("/hu-entry", catchAsync(createHUEntries));

router.patch("/transaction-report/:huId/archive", catchAsync(archiveHU));

export default router;
