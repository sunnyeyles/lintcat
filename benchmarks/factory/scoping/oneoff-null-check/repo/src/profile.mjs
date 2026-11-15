import { findUser } from "./users.mjs";

export function displayName(id) {
  return findUser(id).name;
}
