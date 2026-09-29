/** GET /open?to=... - the support inbox's deep links land here, then go on to the page they name. */
import type { Request, Response } from "express";

import { requestContext } from "../http/request-context.js";

const HOME = "/customers";

export async function openLink(req: Request, res: Response): Promise<void> {
  requestContext(req);

  const target = req.query["to"];
  const destination = typeof target === "string" && target.length > 0 ? target : HOME;

  res.redirect(302, destination);
}
