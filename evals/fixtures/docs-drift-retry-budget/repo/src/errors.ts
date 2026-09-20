/** Thrown while the worker is still booting, before any queue is polled. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}
