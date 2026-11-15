const users = new Map([
  ["u1", { id: "u1", name: "Ada", email: "ada@example.com", avatar: "ada.png", plan: "pro" }],
]);

// Returns undefined for an unknown id.
export function findUser(id) {
  return users.get(id);
}
