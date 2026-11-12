import { boundOutput, finishOutput } from "#src/sandbox/output";
import type { ExecRequest, ExecResult, Sandbox, SandboxConfig, SandboxProvider } from "#src/sandbox/sandbox";

type FakePhase = "setup" | "exec";

export type FakeHandler = (
  request: ExecRequest,
  phase: FakePhase,
) => { exitCode: number; output: string } | Promise<{ exitCode: number; output: string }>;

type FakeSandboxCall =
  | { sandboxId: string; kind: "create"; config: SandboxConfig }
  | { sandboxId: string; kind: FakePhase; request: ExecRequest }
  | { sandboxId: string; kind: "isolate" | "kill" | "destroy" };

export interface FakeSandboxProvider extends SandboxProvider {
  readonly calls: FakeSandboxCall[];
}

const KILLED = Symbol("killed");
const TIMED_OUT = Symbol("timed out");

/** Runs nothing; `kill()` ends in-flight execs, or the next one if none is running, with 137. */
export function createFakeSandboxProvider(
  handler: FakeHandler = () => ({ exitCode: 0, output: "" }),
  options: { secrets?: string[] } = {},
): FakeSandboxProvider {
  const calls: FakeSandboxCall[] = [];
  const secrets = options.secrets ?? [];

  return {
    name: "fake",
    calls,
    async create(config) {
      const id = `factory-${config.runId}`;
      calls.push({ sandboxId: id, kind: "create", config });
      let isolated = false;
      let destroyed = false;
      let pendingKill = false;
      const inFlight = new Set<() => void>();

      const run = async (request: ExecRequest, phase: FakePhase): Promise<ExecResult> => {
        if (destroyed) throw new Error(`sandbox ${id} was destroyed`);
        calls.push({ sandboxId: id, kind: phase, request });
        const started = Date.now();
        const killedNow = pendingKill;
        pendingKill = false;
        let onKill!: () => void;
        const killed = new Promise<typeof KILLED>((resolve) => (onKill = () => resolve(KILLED)));
        inFlight.add(onKill);
        let timer: NodeJS.Timeout | undefined;
        const timedOut = new Promise<typeof TIMED_OUT>((resolve) => {
          timer = setTimeout(() => resolve(TIMED_OUT), request.timeoutMs);
        });
        try {
          const outcome = killedNow
            ? KILLED
            : await Promise.race([Promise.resolve(handler(request, phase)), killed, timedOut]);
          const durationMs = Date.now() - started;
          if (outcome === KILLED || outcome === TIMED_OUT) {
            return { exitCode: 137, timedOut: outcome === TIMED_OUT, durationMs, ...finishOutput("", secrets) };
          }
          const raw = boundOutput(outcome.output);
          return { exitCode: outcome.exitCode, timedOut: false, durationMs, ...finishOutput(raw, secrets) };
        } finally {
          clearTimeout(timer);
          inFlight.delete(onKill);
        }
      };

      return {
        id,
        setup: (request) => run(request, "setup"),
        async isolate() {
          calls.push({ sandboxId: id, kind: "isolate" });
          isolated = true;
        },
        async exec(request) {
          if (!isolated) throw new Error(`sandbox ${id}: exec before isolate() is refused`);
          return run(request, "exec");
        },
        async kill() {
          calls.push({ sandboxId: id, kind: "kill" });
          if (inFlight.size === 0) pendingKill = true;
          for (const kill of inFlight) kill();
        },
        async destroy() {
          calls.push({ sandboxId: id, kind: "destroy" });
          destroyed = true;
        },
      } satisfies Sandbox;
    },
  };
}
