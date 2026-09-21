#!/usr/bin/env node
// Measure computed styles of UI roles on a page: node scripts/measure-computed-styles.mjs <name> <url> [dark]
// Needs a Chromium binary in CHROME (defaults to Playwright's Chrome for Testing on macOS).
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const [name, url, scheme = "light"] = process.argv.slice(2);
if (!name || !url) {
  console.error("usage: measure-computed-styles.mjs <name> <url> [light|dark]");
  process.exit(1);
}

const CHROME =
  process.env.CHROME ??
  join(
    homedir(),
    "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  );
const OUT = process.env.MEASURE_OUT ?? "measurements";

// One role, many candidate selectors: the first selector with visible matches wins.
const ROLES = {
  body: ["body"],
  "page gutter": ["main > div", ".container-xl", ".container-lg", ".Layout", ".monaco-workbench .part.editor"],
  topbar: ["header.AppHeader", "header", ".part.titlebar"],
  sidebar: ["aside[class*='w-[']", ".Layout-sidebar", ".part.sidebar", "aside"],
  "sidebar nav item": ["nav[aria-label='Primary'] a", ".ActionListContent", ".monaco-list-row", ".UnderlineNav-item"],
  h1: ["h1"],
  h2: ["h2"],
  paragraph: ["main p", ".markdown-body p", "p"],
  "muted text": [".text-muted-foreground", ".fgColor-muted", ".color-fg-muted"],
  "button primary": ["[data-slot='button'][data-variant='default']", ".Button--primary", ".btn-primary", ".monaco-button.default"],
  "button outline": ["[data-slot='button'][data-variant='outline']", ".Button--secondary", ".btn:not(.btn-primary)", ".monaco-button.secondary"],
  "button small": ["[data-slot='button'][data-size='sm']", ".Button--small", ".btn-sm"],
  "icon button": ["[data-slot='button'][data-size^='icon']", ".Button--iconOnly", ".btn-octicon", ".action-label"],
  input: ["input[data-slot='input']", "input.form-control", "input[type='text']", ".monaco-inputbox input"],
  "select trigger": ["[data-slot='select-trigger']", ".SelectMenu-button", "summary.btn", ".monaco-select-box"],
  "tab item": ["[data-slot='tabs-trigger']", ".UnderlineNav-item", ".tabnav-tab", ".tabs-container .tab"],
  badge: ["[data-slot='badge']", ".Label", ".IssueLabel", ".State", ".monaco-count-badge"],
  counter: [".Counter", "[data-slot='badge'].tabular-nums"],
  card: ["[data-slot='card']", ".Box", ".monaco-editor-pane"],
  "card header": ["[data-slot='card-header']", ".Box-header"],
  "list row": ["[data-slot='card'] li", ".Box-row", ".js-navigation-item", "[role='row']", ".monaco-list-row"],
  "table cell": ["td", ".react-directory-row-name-cell-large-screen", ".monaco-table-td"],
  "toggle item": ["[data-slot='toggle-group-item']", ".SegmentedControl-item", ".monaco-action-bar .action-item"],
  switch: ["[data-slot='switch']", ".ToggleSwitch-track", ".monaco-toggle"],
  "stat value": ["[data-slot='card-title'].font-mono", ".Counter--primary"],
  "section title": ["[data-slot='card-title']", ".Box-title", ".pane-header .title", ".title-label"],
  "status bar": [".part.statusbar"],
  "activity bar": [".part.activitybar"],
};

const PROPS = [
  "fontSize", "lineHeight", "fontWeight", "letterSpacing", "fontFamily",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "borderRadius", "borderTopWidth", "gap", "color", "backgroundColor", "borderTopColor", "boxShadow",
];

const probe = `(() => {
  const ROLES = ${JSON.stringify(ROLES)};
  const PROPS = ${JSON.stringify(PROPS)};
  const px = (v) => Math.round(parseFloat(v) * 10) / 10;
  const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const out = {};
  for (const [role, selectors] of Object.entries(ROLES)) {
    for (const selector of selectors) {
      let els = [];
      try { els = [...document.querySelectorAll(selector)].filter(visible).slice(0, 40); } catch { continue; }
      if (!els.length) continue;
      const rows = els.map((el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); const o = { width: px(r.width), height: px(r.height) }; for (const p of PROPS) o[p] = cs[p]; return o; });
      const agg = { selector, n: els.length, width: median(rows.map((r) => r.width)), height: median(rows.map((r) => r.height)) };
      for (const p of PROPS) {
        const vals = rows.map((r) => r[p]);
        const nums = vals.map((v) => parseFloat(v)).filter((v) => !Number.isNaN(v));
        agg[p] = (p === 'fontFamily' || p === 'color' || p === 'backgroundColor' || p === 'borderTopColor' || p === 'boxShadow' || p === 'lineHeight' && vals[0] === 'normal')
          ? vals.sort().reduce((best, v, _, arr) => arr.filter((x) => x === v).length > arr.filter((x) => x === best).length ? v : best, vals[0])
          : (nums.length === vals.length ? median(nums) : vals[0]);
      }
      out[role] = agg;
      break;
    }
  }
  return JSON.stringify({ url: location.href, title: document.title, viewport: [innerWidth, innerHeight], roles: out });
})()`;

function launch() {
  const child = spawn(
    CHROME,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${join(process.env.TMPDIR ?? "/tmp", "measure-chrome-profile")}`,
      "--window-size=1440,900",
      "--no-first-run",
      "--disable-gpu",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  return new Promise((resolve, reject) => {
    let err = "";
    child.stderr.on("data", (chunk) => {
      err += chunk;
      const m = err.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) resolve({ child, wsUrl: m[1] });
    });
    child.on("exit", (code) => reject(new Error(`chrome exited ${code}: ${err}`)));
    setTimeout(() => reject(new Error("chrome did not start: " + err)), 15000);
  });
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) this.events.push(msg);
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { child, wsUrl } = await launch();
try {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const cdp = new Cdp(ws);
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] }, sessionId);
  await cdp.send("Page.navigate", { url }, sessionId);
  await sleep(Number(process.env.MEASURE_SETTLE_MS ?? 6000));
  const { result } = await cdp.send("Runtime.evaluate", { expression: probe, returnByValue: true }, sessionId);
  const data = JSON.parse(result.value);
  data.scheme = scheme;
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, `${name}.json`);
  writeFileSync(file, JSON.stringify(data, null, 2));
  const rows = Object.entries(data.roles).map(([role, r]) =>
    `${role.padEnd(18)} n=${String(r.n).padStart(2)}  h=${String(r.height).padStart(5)}  fs=${String(r.fontSize).padEnd(6)} lh=${String(r.lineHeight).padEnd(6)} fw=${String(r.fontWeight).padEnd(3)} pad=${[r.paddingTop, r.paddingRight, r.paddingBottom, r.paddingLeft].map((p) => String(p).replace("px", "")).join("/").padEnd(14)} r=${String(r.borderRadius).padEnd(7)} gap=${String(r.gap).padEnd(6)} ${r.selector}`,
  );
  console.log(`# ${name} (${scheme}) ${data.title} @ ${data.url}\n${rows.join("\n")}\n-> ${file}`);
} finally {
  child.kill();
}
