import express from "express";
import asyncHandler from "../middleware/asyncHandler.js";

import {
  createProduction,
  getProductions,
  getPaginatedProductions,
  getProductionById,
} from "../controllers/production.controller.js";

const router = express.Router();

router.post("/production-data", asyncHandler(createProduction));

router.get("/production-data", asyncHandler(getProductions));

router.get("/paginated-prod", asyncHandler(getPaginatedProductions));

router.get("/production-data/:id", asyncHandler(getProductionById));

export default router;
