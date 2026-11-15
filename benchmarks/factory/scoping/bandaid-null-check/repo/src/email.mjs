import { findUser } from "./users.mjs";

export function emailFor(id) {
  return findUser(id).email.toLowerCase();
}
