import { findUser } from "./users.mjs";

export function invoicePlan(id) {
  return findUser(id).plan.toUpperCase();
}
