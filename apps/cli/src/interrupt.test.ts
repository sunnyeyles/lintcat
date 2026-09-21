import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { cancelOnInterrupt } from "#src/interrupt";

function setup() {
  const source = new EventEmitter();
  const err = vi.fn();
  const exit = vi.fn();
  const interrupt = cancelOnInterrupt({ source, err, exit });
  return { source, err, exit, interrupt };
}

describe("interrupting the command", () => {
  it("aborts the review on the first Ctrl-C without exiting", () => {
    const { source, err, exit, interrupt } = setup();

    source.emit("SIGINT");

    expect(interrupt.signal.aborted).toBe(true);
    expect(err).toHaveBeenCalledWith(expect.stringContaining("cancelling the review"));
    expect(exit).not.toHaveBeenCalled();
  });

  it("treats SIGTERM as a cancellation too", () => {
    const { source, interrupt } = setup();

    source.emit("SIGTERM");

    expect(interrupt.signal.aborted).toBe(true);
  });

  it("quits immediately on a second interrupt", () => {
    const { source, exit } = setup();

    source.emit("SIGINT");
    source.emit("SIGINT");

    expect(exit).toHaveBeenCalledWith(130);
  });

  it("stops listening once disposed", () => {
    const { source, interrupt } = setup();

    interrupt.dispose();

    expect(source.listenerCount("SIGINT")).toBe(0);
    expect(source.listenerCount("SIGTERM")).toBe(0);
  });
});
