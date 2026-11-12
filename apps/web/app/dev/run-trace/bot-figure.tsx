import { cn } from "@pr-review/design";
import type { ReactNode } from "react";

import type { Accessory, BotLook } from "@/app/dev/run-trace/bot-look";
import type { BotStatus } from "@/app/dev/run-trace/bot-view";
import styles from "@/app/dev/run-trace/bots.module.css";
import { CONTEXT_LIMIT } from "@/app/dev/run-trace/trace-layout";

const INK = "var(--foreground)";
const FACE = "var(--card)";
const LINE = {
  stroke: INK,
  strokeWidth: 2.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function fuelColor(fraction: number): string {
  if (fraction >= 0.85) return "var(--destructive)";
  if (fraction >= 0.6) return "var(--warning)";
  return "var(--success)";
}

export function BotFigure({
  look,
  status,
  activeTool,
  peakContext,
  className,
}: {
  look: BotLook;
  status?: BotStatus;
  activeTool?: string;
  peakContext?: number;
  className?: string;
}) {
  const running = status === "running";
  return (
    <svg viewBox="0 0 120 140" className={cn("overflow-visible", className)} aria-hidden="true">
      <g className={cn(styles.figure)} style={{ transformOrigin: "60px 130px" }}>
        <g className={running ? styles.bob : undefined}>
          <ellipse cx="60" cy="134" rx="30" ry="4" fill="var(--muted)" />
          <rect x="44" y="122" width="12" height="10" rx="3" fill={INK} />
          <rect x="64" y="122" width="12" height="10" rx="3" fill={INK} />
          <path d="M32 98 Q22 104 24 114" fill="none" {...LINE} />
          <path d="M88 98 Q98 104 96 114" fill="none" {...LINE} />
          <rect x="36" y="88" width="48" height="36" rx="12" fill={look.color} {...LINE} />
          <rect x="54" y="82" width="12" height="8" fill={INK} />
          {peakContext !== undefined ? (
            <FuelGauge tokens={peakContext} />
          ) : (
            <circle cx="60" cy="106" r="3" fill={FACE} />
          )}
          <rect x="28" y="38" width="64" height="46" rx="16" fill={look.color} {...LINE} />
          <rect x="37" y="47" width="46" height="28" rx="9" fill={FACE} />
          <Face status={status} />
          <circle cx="27" cy="61" r="4" fill={INK} />
          <circle cx="93" cy="61" r="4" fill={INK} />
          <Gear accessory={look.accessory} />
          {status === "done" ? <Check /> : null}
          {status === "failed" ? <Trouble /> : null}
          {running ? <ToolPop tool={activeTool} /> : null}
        </g>
      </g>
    </svg>
  );
}

function Face({ status }: { status?: BotStatus }) {
  if (status === "failed") {
    return (
      <g {...LINE} fill="none">
        <path d="M46 57 l8 8 M54 57 l-8 8 M66 57 l8 8 M74 57 l-8 8" />
        <path d="M52 72 Q60 67 68 72" />
      </g>
    );
  }
  if (status === "done") {
    return (
      <g {...LINE} fill="none">
        <path d="M45 63 Q50 56 55 63 M65 63 Q70 56 75 63" />
        <path d="M51 68 Q60 75 69 68" />
      </g>
    );
  }
  return (
    <>
      <g className={status === "running" ? styles.blink : undefined}>
        <circle cx="50" cy="61" r="4.5" fill={INK} />
        <circle cx="70" cy="61" r="4.5" fill={INK} />
      </g>
      <path d="M54 70 Q60 73 66 70" fill="none" {...LINE} />
    </>
  );
}

function FuelGauge({ tokens }: { tokens: number }) {
  const fraction = Math.min(1, tokens / CONTEXT_LIMIT);
  return (
    <g>
      <path d="M48 112 A12 12 0 0 1 72 112" fill="none" stroke={FACE} strokeWidth="6" strokeLinecap="round" />
      <path
        d="M48 112 A12 12 0 0 1 72 112"
        fill="none"
        stroke={fuelColor(fraction)}
        strokeWidth="6"
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray={`${Math.max(1, fraction * 100)} 100`}
      />
      <circle cx="60" cy="112" r="2.5" fill={INK} />
    </g>
  );
}

function Check() {
  return (
    <g>
      <circle cx="98" cy="38" r="10" fill="var(--success)" stroke={FACE} strokeWidth="2.5" />
      <path
        d="M93 38 l4 4 l7 -8"
        fill="none"
        stroke="var(--success-foreground)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  );
}

function Trouble() {
  return (
    <g>
      <path
        d="M98 26 l3 8 l8 1 l-6 5 l2 8 l-7 -4 l-7 4 l2 -8 l-6 -5 l8 -1 z"
        fill="var(--destructive)"
        stroke={FACE}
        strokeWidth="1.5"
      />
      <path d="M22 40 Q16 50 22 54 Q28 50 22 40 z" fill="var(--chart-3)" stroke={INK} strokeWidth="1.5" />
    </g>
  );
}

function ToolPop({ tool }: { tool?: string }) {
  const label = tool ? (tool.length > 7 ? `${tool.slice(0, 6)}…` : tool) : "···";
  return (
    <g className={styles.pop}>
      <rect x="34" y="2" width="52" height="20" rx="10" fill="var(--primary)" stroke={FACE} strokeWidth="2" />
      <path d="M56 22 l4 6 l4 -6 z" fill="var(--primary)" />
      <text x="60" y="16" textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--primary-foreground)">
        {label}
      </text>
    </g>
  );
}

const GEAR: Record<Accessory, () => ReactNode> = {
  hat: () => (
    <g>
      <path d="M32 40 Q32 18 60 18 Q88 18 88 40 z" fill="var(--warning)" {...LINE} />
      <path d="M24 41 H96" {...LINE} strokeWidth={4} />
      <path d="M60 18 V40" stroke={INK} strokeWidth="2" />
    </g>
  ),
  clipboard: () => (
    <g>
      <rect x="92" y="96" width="22" height="28" rx="3" fill={FACE} {...LINE} />
      <rect x="98" y="92" width="10" height="6" rx="2" fill={INK} />
      <path d="M97 106 h12 M97 112 h12 M97 118 h8" stroke={INK} strokeWidth="2" strokeLinecap="round" />
      <path d="M60 38 V28" {...LINE} />
      <circle cx="60" cy="26" r="4" fill={INK} />
    </g>
  ),
  magnifier: () => (
    <g>
      <path d="M103 122 L112 133" {...LINE} strokeWidth={5} />
      <circle cx="98" cy="114" r="10" fill={FACE} fillOpacity={0.6} {...LINE} strokeWidth={3.5} />
      <path d="M60 38 V28" {...LINE} />
      <circle cx="60" cy="26" r="4" fill={INK} />
    </g>
  ),
  wrench: () => (
    <g>
      <path d="M96 116 L110 100" {...LINE} strokeWidth={5} />
      <path d="M106 96 a7 7 0 1 0 8 8 l-4 -1 l-3 -3 z" fill={INK} />
      <path d="M60 38 V28" {...LINE} />
      <circle cx="60" cy="26" r="4" fill={INK} />
    </g>
  ),
  glasses: () => (
    <g fill="none" {...LINE}>
      <circle cx="50" cy="61" r="8" />
      <circle cx="70" cy="61" r="8" />
      <path d="M58 60 h4 M42 59 L34 56 M78 59 L86 56" />
      <path d="M60 38 V28" />
      <circle cx="60" cy="26" r="4" fill={INK} />
    </g>
  ),
  eyebrow: () => (
    <g>
      <path d="M43 50 L56 44" {...LINE} strokeWidth={3.5} />
      <path d="M64 53 L77 53" {...LINE} strokeWidth={3.5} />
      <path d="M98 128 L104 100" {...LINE} strokeWidth={4} />
      <rect x="94" y="92" width="22" height="11" rx="2" fill={INK} transform="rotate(12 105 97)" />
    </g>
  ),
  antenna: () => (
    <g>
      <path d="M60 38 V20" {...LINE} />
      <circle cx="60" cy="16" r="6" fill="var(--chart-4)" {...LINE} />
    </g>
  ),
  propeller: () => (
    <g>
      <path d="M44 40 Q44 28 60 28 Q76 28 76 40 z" fill="var(--chart-2)" {...LINE} />
      <path d="M60 28 V20" {...LINE} />
      <ellipse cx="48" cy="18" rx="12" ry="4" fill="var(--chart-5)" {...LINE} strokeWidth={2} />
      <ellipse cx="72" cy="18" rx="12" ry="4" fill="var(--chart-5)" {...LINE} strokeWidth={2} />
    </g>
  ),
  headphones: () => (
    <g>
      <path d="M26 58 Q26 24 60 24 Q94 24 94 58" fill="none" {...LINE} strokeWidth={4} />
      <rect x="18" y="52" width="12" height="20" rx="5" fill="var(--chart-5)" {...LINE} />
      <rect x="90" y="52" width="12" height="20" rx="5" fill="var(--chart-5)" {...LINE} />
    </g>
  ),
  bowtie: () => (
    <g>
      <path d="M60 88 L46 80 V96 z M60 88 L74 80 V96 z" fill="var(--destructive)" {...LINE} strokeWidth={2} />
      <circle cx="60" cy="88" r="3.5" fill={INK} />
      <path d="M60 38 V28" {...LINE} />
      <circle cx="60" cy="26" r="4" fill={INK} />
    </g>
  ),
  flower: () => (
    <g>
      <path d="M78 38 Q80 30 84 24" fill="none" {...LINE} strokeWidth={2} />
      {[0, 72, 144, 216, 288].map((angle) => (
        <ellipse key={angle} cx="84" cy="15" rx="4" ry="7" fill="var(--chart-2)" transform={`rotate(${angle} 84 22)`} />
      ))}
      <circle cx="84" cy="22" r="4" fill="var(--warning)" />
    </g>
  ),
};

function Gear({ accessory }: { accessory: Accessory }) {
  return GEAR[accessory]();
}
