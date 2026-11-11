export function greet(name, { excited = false } = {}) {
  return `Hello, ${name}${excited ? "!" : ""}`;
}
