/** Ctrl-C cancels the review through its signal; a second one quits on the spot. */

export type StopSignal = "SIGINT" | "SIGTERM";

export interface SignalSource {
  on(event: StopSignal, listener: () => void): unknown;
  off(event: StopSignal, listener: () => void): unknown;
}

export interface InterruptDeps {
  source: SignalSource;
  err: (text: string) => void;
  exit: (code: number) => void;
}

// The shell's convention for a process killed by a signal.
const SIGNAL_EXIT: Record<StopSignal, number> = { SIGINT: 130, SIGTERM: 143 };
const SIGNALS = Object.keys(SIGNAL_EXIT) as StopSignal[];

export interface Interrupt {
  signal: AbortSignal;
  /** Stops listening, so a finished process is not held open. */
  dispose: () => void;
}

export function cancelOnInterrupt({ source, err, exit }: InterruptDeps): Interrupt {
  const controller = new AbortController();
  const listeners = SIGNALS.map((name) => {
    const listener = (): void => {
      if (controller.signal.aborted) {
        exit(SIGNAL_EXIT[name]);
        return;
      }
      err("pr-review: cancelling the review. Interrupt again to quit immediately.");
      controller.abort();
    };
    source.on(name, listener);
    return [name, listener] as const;
  });
  return {
    signal: controller.signal,
    dispose: () => {
      for (const [name, listener] of listeners) source.off(name, listener);
    },
  };
}
