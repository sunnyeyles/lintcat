/** Thrown when a notification could not be delivered and will not be tried again. */
export class DeliveryError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DeliveryError";
  }
}
