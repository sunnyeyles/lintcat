/** Route table for the invoicing service API. */
import { Router } from "express";

import { getOrderSummary } from "./order-summary.js";

export function createRouter(): Router {
  const router = Router();

  router.get("/orders/:orderId/summary", getOrderSummary);

  return router;
}
