/** Route table for the support console API. */
import { Router } from "express";

import { getCustomers } from "./customers.js";
import { openLink } from "./open-link.js";

export function createRouter(): Router {
  const router = Router();

  router.get("/customers", getCustomers);
  router.get("/open", openLink);

  return router;
}
