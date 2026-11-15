/** Where untrusted commands run. The host never executes repository code itself. */
export interface SandboxLimits {
  cpus: number;
  memoryMb: number;
  pids: number;
  tmpfsMb: number;
}

export interface SandboxConfig {
  runId: string;
  /** Host path mounted read-write at /workspace; nothing else is mounted. */
  worktreePath: string;
  image: string;
  limits: SandboxLimits;
}

export interface ExecRequest {
  command: string;
  timeoutMs: number;
  /** Relative to /workspace. */
  cwd?: string;
}

export interface ExecResult {
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
  /** Bounded to head and tail, secrets redacted. */
  output: string;
  /** sha256 of the normalised output, for spotting repeated identical failures. */
  outputHash: string;
}

export interface Sandbox {
  readonly id: string;
  /** Runs with network, before any agent-written code exists. */
  setup(request: ExecRequest): Promise<ExecResult>;
  /** Cuts the network; every later exec is offline. Idempotent. */
  isolate(): Promise<void>;
  exec(request: ExecRequest): Promise<ExecResult>;
  /** Kills whatever is running, keeps the worktree. */
  kill(): Promise<void>;
  destroy(): Promise<void>;
}

export interface SandboxProvider {
  readonly name: string;
  /** Replaces any leftover sandbox for the same run, so recovery starts clean. */
  create(config: SandboxConfig): Promise<Sandbox>;
}

export const DEFAULT_LIMITS: SandboxLimits = { cpus: 2, memoryMb: 4096, pids: 512, tmpfsMb: 2048 };
export const SANDBOX_IMAGE = "lintcat-factory-sandbox:1";
