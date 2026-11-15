import { findUser } from "./users.mjs";

export function invoicePlan(id) {
  const user = findUser(id);
  if (!user) throw new RangeError(`no user ${id}`);
  return user.plan.toUpperCase();
}
