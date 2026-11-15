import { findUser } from "./users.mjs";

export function avatarUrl(id) {
  const user = findUser(id);
  return user ? `/avatars/${user.avatar}` : "/avatars/default.png";
}
