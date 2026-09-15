export type DateLike = Date | string | number;

const TOKEN_UNITS = ["", "k", "M", "B", "T"] as const;

function trimZero(value: string): string {
  return value.endsWith(".0") ? value.slice(0, -2) : value;
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const rounded = Math.abs(n) < 1 && n !== 0 ? n : Math.round(n * 100) / 100;
  return rounded.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function formatTokens(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  let value = Math.abs(n);
  let unit = 0;
  while (value >= 1000 && unit < TOKEN_UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  if (unit > 0 && Number(value.toFixed(1)) >= 1000 && unit < TOKEN_UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const body = unit === 0 ? String(Math.round(value)) : trimZero(value.toFixed(1));
  return `${sign}${body}${TOKEN_UNITS[unit]}`;
}

export function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const value = Math.abs(n);
  if (value !== 0 && value < 0.01) {
    return `${sign}$${value.toFixed(4)}`;
  }
  return `${sign}$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  const sign = ms < 0 ? "-" : "";
  const total = Math.abs(ms);
  if (total < 1000) return `${sign}${Math.round(total)}ms`;

  const seconds = total / 1000;
  if (seconds < 60) return `${sign}${trimZero(seconds.toFixed(1))}s`;

  const wholeSeconds = Math.round(seconds);
  if (wholeSeconds < 3600) {
    const m = Math.floor(wholeSeconds / 60);
    const s = wholeSeconds % 60;
    return s === 0 ? `${sign}${m}m` : `${sign}${m}m ${s}s`;
  }

  const h = Math.floor(wholeSeconds / 3600);
  const m = Math.round((wholeSeconds % 3600) / 60);
  return m === 0 ? `${sign}${h}h` : `${sign}${h}h ${m}m`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

export function formatRelative(date: DateLike, now: DateLike = Date.now()): string {
  const then = new Date(date).getTime();
  const base = new Date(now).getTime();
  if (!Number.isFinite(then) || !Number.isFinite(base)) return "—";

  const delta = base - then;
  const abs = Math.abs(delta);
  const suffix = (body: string) => (delta < 0 ? `in ${body}` : `${body} ago`);

  if (abs < MINUTE) return "just now";
  if (abs < HOUR) return suffix(`${Math.floor(abs / MINUTE)}m`);
  if (abs < DAY) return suffix(`${Math.floor(abs / HOUR)}h`);
  if (abs < MONTH) return suffix(`${Math.floor(abs / DAY)}d`);
  if (abs < YEAR) return suffix(`${Math.floor(abs / MONTH)}mo`);
  return suffix(`${Math.floor(abs / YEAR)}y`);
}

export function shortSha(sha: string): string {
  return sha.trim().slice(0, 7);
}
