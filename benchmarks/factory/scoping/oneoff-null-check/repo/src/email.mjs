import { findUser } from "./users.mjs";

export function emailFor(id) {
  const user = findUser(id);
  return user ? user.email.toLowerCase() : null;
}
