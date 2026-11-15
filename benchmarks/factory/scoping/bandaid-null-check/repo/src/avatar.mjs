import { findUser } from "./users.mjs";

export function avatarUrl(id) {
  return `/avatars/${findUser(id).avatar}`;
}
