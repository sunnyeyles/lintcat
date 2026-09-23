/** GET /collections - the collections team's work queue. */
import type { Request, Response } from "express";

import { requestContext } from "../http/request-context.js";
import { collectionQueue } from "../services/collections.js";

export async function getCollections(req: Request, res: Response): Promise<void> {
  const ctx = requestContext(req);
  res.json({ items: await collectionQueue(ctx, new Date()) });
}
