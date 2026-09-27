// Drafts the #architecture package graph as a cyanotype sheet, in the order of anidoodle's
// blueprint plate, then lights the packages each stage of the page runs in.
(() => {
  const source = document.getElementById("architecture");
  const figure = document.querySelector("[data-architecture]");
  if (!source || !figure) return;
  const { nodes } = JSON.parse(source.textContent);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const NS = "http://www.w3.org/2000/svg";

  const reach = new Map();
  const reachOf = (id) => {
    if (!reach.has(id)) {
      const all = new Set();
      for (const dep of byId.get(id).imports) {
        all.add(dep);
        for (const d of reachOf(dep)) all.add(d);
      }
      reach.set(id, all);
    }
    return reach.get(id);
  };
  // An import another import already implies adds a line and no information.
  const edges = nodes.flatMap((n) =>
    n.imports
      .filter((dep) => !n.imports.some((other) => other !== dep && reachOf(other).has(dep)))
      .map((dep) => ({ from: n.id, to: dep })),
  );

  const topLayer = Math.max(0, ...nodes.filter((n) => n.kind === "package").map((n) => n.layer));
  const sparse = [];
  for (const n of nodes) (sparse[n.kind === "entry" ? 0 : 1 + topLayer - n.layer] ??= []).push(n.id);
  const rows = sparse.filter(Boolean);
  const tier = new Map(rows.flatMap((row, t) => row.map((id) => [id, t])));

  const nbrs = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    nbrs.get(e.from).push(e.to);
    nbrs.get(e.to).push(e.from);
  }
  const rel = new Map();
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  for (let pass = 0; pass < 6; pass++) {
    for (const t of pass % 2 ? [...rows.keys()].reverse() : rows.keys()) {
      rows.forEach((row) => row.forEach((id, i) => rel.set(id, (i + 0.5) / row.length)));
      const want = new Map(
        rows[t].map((id) => {
          const near = nbrs.get(id).filter((o) => tier.get(o) !== t);
          return [id, near.length ? mean(near.map((o) => rel.get(o))) : rel.get(id)];
        }),
      );
      rows[t].sort((a, b) => want.get(a) - want.get(b));
    }
  }
  for (const e of edges) {
    if (tier.get(e.from) !== tier.get(e.to)) continue;
    const row = rows[tier.get(e.from)];
    row.splice(row.indexOf(e.from), 1);
    row.splice(row.indexOf(e.to) + 1, 0, e.from);
  }

  const W = 760, L = 112, R = 58, GAP = 16, BH = 40, LANE = 8, TOP = 96;
  const widest = Math.max(...rows.map((row) => row.length));
  const slot = (W - L - R) / widest;
  const BW = Math.min(124, slot - GAP);
  const cx = new Map();
  rows.forEach((row) => {
    if (row.length === widest) row.forEach((id, i) => cx.set(id, L + slot * (i + 0.5)));
  });
  rows.forEach((row) => {
    if (row.length === widest) return;
    const want = row.map((id) => {
      const xs = nbrs.get(id).filter((o) => cx.has(o)).map((o) => cx.get(o));
      return xs.length ? mean(xs) : L + (W - L - R) / 2;
    });
    for (let i = 1; i < row.length; i++) want[i] = Math.max(want[i], want[i - 1] + BW + GAP);
    const over = want[row.length - 1] - (W - R - BW / 2);
    for (let i = 0; i < row.length && over > 0; i++) want[i] -= over;
    const under = L + BW / 2 - want[0];
    for (let i = 0; i < row.length && under > 0; i++) want[i] += under;
    row.forEach((id, i) => cx.set(id, want[i]));
  });
  const left = (id) => cx.get(id) - BW / 2;

  const cross = edges.filter((e) => tier.get(e.from) !== tier.get(e.to));
  const groupBy = (key) => {
    const out = new Map();
    for (const e of cross) out.set(e[key], [...(out.get(e[key]) ?? []), e]);
    return out;
  };
  for (const [id, list] of groupBy("from")) {
    list.sort((a, b) => cx.get(a.to) - cx.get(b.to));
    list.forEach((e, k) => (e.sx = left(id) + (BW * (k + 1)) / (list.length + 1)));
  }
  // A line that skips a layer drops through a gap between that layer's boxes.
  const corridors = [];
  const blocked = (self, x, t0, t1) =>
    x < L ||
    x > W - R ||
    rows.slice(t0, t1 + 1).some((row) => row.some((id) => Math.abs(x - cx.get(id)) < BW / 2 + 8)) ||
    [...corridors, ...cross.filter((e) => e !== self).map((e) => e.sx)].some((c) => Math.abs(c - x) < 6);
  for (const e of cross) {
    const [tu, tv] = [tier.get(e.from), tier.get(e.to)];
    if (tv - tu < 2) continue;
    for (let d = 0; d < W && e.cx === undefined; d += 2) {
      e.cx = [e.sx + d, e.sx - d].find((x) => !blocked(e, x, tu + 1, tv - 1));
    }
    if (e.cx !== undefined) corridors.push(e.cx);
  }
  const arrive = (e) => e.cx ?? e.sx;
  for (const [id, list] of groupBy("to")) {
    list.sort((a, b) => arrive(a) - arrive(b));
    list.forEach((e, k) => (e.tx = left(id) + (BW * (k + 1)) / (list.length + 1)));
  }

  const channels = rows.map(() => []);
  for (const e of cross) {
    const [tu, tv] = [tier.get(e.from), tier.get(e.to)];
    e.runs = [];
    if (Math.abs(arrive(e) - e.sx) > 0.5) e.runs.push({ c: tu, a: e.sx, b: arrive(e) });
    if (Math.abs(e.tx - arrive(e)) > 0.5) e.runs.push({ c: tv - 1, a: arrive(e), b: e.tx });
    for (const run of e.runs) channels[run.c].push(run);
  }
  // Rightward runs that start furthest right take the top lane, so fewer lines cross.
  const laneCount = channels.map((runs) => {
    const lanes = [];
    const key = (r) => (r.b > r.a ? -r.a : W + r.a);
    for (const run of [...runs].sort((p, q) => key(p) - key(q))) {
      const lo = Math.min(run.a, run.b) - 6, hi = Math.max(run.a, run.b) + 6;
      let k = lanes.findIndex((used) => used.every(([a, b]) => hi < a || lo > b));
      if (k < 0) k = lanes.push([]) - 1;
      lanes[k].push([lo, hi]);
      run.lane = k;
    }
    return lanes.length;
  });
  const chH = laneCount.map((n) => Math.max(34, (n + 1) * LANE + 12));
  const rowTop = [TOP];
  for (let t = 1; t < rows.length; t++) rowTop[t] = rowTop[t - 1] + BH + chH[t - 1];
  const laneY = (c, k) => rowTop[c] + BH + (chH[c] - (laneCount[c] - 1) * LANE) / 2 + k * LANE;
  const top = (id) => rowTop[tier.get(id)];
  for (const e of cross) {
    const pts = [[e.sx, top(e.from) + BH]];
    let x = e.sx;
    for (const run of e.runs) {
      const y = laneY(run.c, run.lane);
      pts.push([x, y], [run.b, y]);
      x = run.b;
    }
    pts.push([x, top(e.to)]);
    e.pts = pts;
  }
  for (const e of edges) {
    if (tier.get(e.from) !== tier.get(e.to)) continue;
    const dir = Math.sign(cx.get(e.to) - cx.get(e.from));
    const y = top(e.from) + BH / 2;
    e.pts = [[cx.get(e.from) + (dir * BW) / 2, y], [cx.get(e.to) - (dir * BW) / 2, y]];
  }
  const last = rows.length - 1;
  const H = rowTop[last] + BH + 108;

  let seed = 0x5eed;
  const rng = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const f = (n) => Math.round(n * 10) / 10;
  // The ruling pen is never dead straight: each long stroke bows by a seeded fraction of a pixel.
  const ruled = (pts, closed = false) => {
    const list = closed ? [...pts, pts[0]] : pts;
    let d = `M${f(list[0][0])} ${f(list[0][1])}`;
    for (let i = 1; i < list.length; i++) {
      const [x0, y0] = list[i - 1], [x1, y1] = list[i];
      const len = Math.hypot(x1 - x0, y1 - y0) || 1;
      const bow = len > 30 ? (rng() - 0.5) * 1.4 : 0;
      const mx = (x0 + x1) / 2 - ((y1 - y0) / len) * bow;
      const my = (y0 + y1) / 2 + ((x1 - x0) / len) * bow;
      d += `Q${f(mx)} ${f(my)} ${f(x1)} ${f(y1)}`;
    }
    return d;
  };
  const rect = (x, y, w, h) => ruled([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true);
  const arrowHead = ([x0, y0], [x1, y1], size = 6) => {
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const [ux, uy] = [(x1 - x0) / len, (y1 - y0) / len];
    const [bx, by] = [x1 - ux * size, y1 - uy * size];
    return `M${f(x1)} ${f(y1)}L${f(bx - uy * size * 0.38)} ${f(by + ux * size * 0.38)}L${f(bx + uy * size * 0.38)} ${f(by - ux * size * 0.38)}Z`;
  };

  const el = (name, attrs, parent) => {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    parent?.append(node);
    return node;
  };
  const write = (str, attrs, parent) => {
    const node = el("text", attrs, parent);
    node.textContent = str;
    return node;
  };

  const svg = figure.querySelector("svg.bp");
  const caption = figure.querySelector("[data-sheet-caption]");
  const packages = nodes.filter((n) => n.kind === "package");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.querySelector("title").textContent =
    `Architecture map: ${nodes.length} workspace packages in ${rows.length} layers, ` +
    "each arrow pointing at what a package imports.";
  const defs = el("defs", {}, svg);
  const layer = (cls) => el("g", { class: cls }, svg);
  const consLayer = layer("cons-layer"), frameLayer = layer("frame-layer");
  const edgeLayer = layer("edge-layer"), nodeLayer = el("g", { role: "list" }, svg);
  const noteLayer = layer("note-layer");

  const plan = [];
  let at = 0;
  const TEMPO = 0.7;
  const queue = (dur, draw, nib = null, together = false) => {
    const start = together && plan.length ? plan[plan.length - 1].at : at;
    plan.push({ at: start, dur: dur * TEMPO, draw, nib, p: -1 });
    at = Math.max(at, start + dur * TEMPO + 35);
  };
  const stroke = (path, together = false) => {
    const len = path.getTotalLength();
    queue(
      Math.max(80, Math.min(450, len / 2.2)),
      (p) => {
        path.style.visibility = p > 0 ? "" : "hidden";
        path.style.strokeDasharray = p < 1 ? `${len} ${len}` : "";
        path.style.strokeDashoffset = p < 1 ? String(len * (1 - p)) : "";
      },
      (p) => path.getPointAtLength(len * p),
      together,
    );
  };
  let clips = 0;
  const wipe = (node, { together = false, perChar = 9, nib = true } = {}) => {
    const box = node.getBBox();
    const id = `bp-clip-${clips++}`;
    const edge = el("rect", { x: box.x - 3, y: box.y - 3, width: 0, height: box.height + 6 }, el("clipPath", { id }, defs));
    const full = box.width + 6;
    queue(
      Math.max(90, (node.textContent.length || 12) * perChar),
      (p) => {
        if (p >= 1) node.removeAttribute("clip-path");
        else node.setAttribute("clip-path", `url(#${id})`);
        edge.setAttribute("width", String(full * p));
      },
      nib ? (p) => ({ x: box.x - 3 + full * p, y: box.y + box.height * 0.8 }) : null,
      together,
    );
  };
  const stamp = (node, together = false) =>
    queue(0, (p) => (node.style.visibility = p >= 1 ? "" : "hidden"), null, together);
  const say = (text) =>
    plan.push({ at, dur: 0, draw: (p) => p >= 1 && (caption.textContent = text), nib: null, p: -1 });
  // The dimension line breaks for its figure, as a draughtsman leaves a gap for it.
  const dimension = (str, x, y, upright = false) => {
    const g = el("g", upright ? { transform: `rotate(-90 ${x} ${y})` } : {}, noteLayer);
    const gap = el("rect", { class: "fill" }, g);
    const label = write(str, { class: "dim-t", x, y: y + 3, "text-anchor": "middle" }, g);
    const box = label.getBBox();
    for (const [k, v] of Object.entries({ x: box.x - 5, y: box.y - 1, width: box.width + 10, height: box.height + 2 })) {
      gap.setAttribute(k, f(v));
    }
    stamp(gap);
    wipe(label, { together: true, perChar: 16, nib: !upright });
  };

  const blurb = (t) => {
    const first = byId.get(rows[t][0]);
    const ids = rows[t].join(", ");
    if (first.kind === "entry") return ["Entry points", "what runs", `Entry points: ${ids}. The things that run.`];
    if (first.layer === 0) return ["Foundations", "import nothing", `Foundations: ${ids}. They import nothing else in the workspace.`];
    if (first.layer === topLayer) return ["Core", `layer ${first.layer}`, `Core: ${ids}. Only entry points import it.`];
    return ["Services", `layer ${first.layer}`, `${ids}: each imports only the layers below.`];
  };

  function build() {
    say(`Drawn from ${nodes.length} package.json files, in the order the packages could be built.`);
    stroke(el("path", { class: "ink", d: rect(10, 10, W - 20, H - 20) }, frameLayer));
    const ticks = [];
    for (let i = 1; i < 6; i++) {
      const x = f(10 + ((W - 20) * i) / 6);
      ticks.push(`M${x} 10v6M${x} ${H - 10}v-6`);
    }
    for (let i = 1; i < 4; i++) {
      const y = f(10 + ((H - 20) * i) / 4);
      ticks.push(`M10 ${y}h6M${W - 10} ${y}h-6`);
    }
    stroke(el("path", { class: "fine", d: ticks.join("") }, frameLayer));
    const tb = { x: W - 16 - 240, y: H - 16 - 62, w: 240, h: 62 };
    stroke(el("path", { class: "ink", d: rect(tb.x, tb.y, tb.w, tb.h) }, frameLayer));
    stroke(el("path", {
      class: "fine",
      d: `${ruled([[tb.x, tb.y + 24], [tb.x + tb.w, tb.y + 24]])}${ruled([[tb.x, tb.y + 43], [tb.x + tb.w, tb.y + 43]])}${ruled([[tb.x + 70, tb.y + 24], [tb.x + 70, tb.y + tb.h]])}`,
    }, frameLayer));

    for (let t = last; t >= 0; t--) {
      const [name, sub, text] = blurb(t);
      const mid = rowTop[t] + BH / 2;
      say(text);
      wipe(el("line", { class: "cons", x1: L - 10, y1: mid, x2: W - R + 10, y2: mid }, consLayer), { perChar: 11, nib: false });
      wipe(write(name, { class: "lbl", x: 26, y: mid - 1 }, noteLayer), { perChar: 18 });
      wipe(write(sub, { class: "lbl-sub", x: 26, y: mid + 10 }, noteLayer), { together: true, perChar: 18 });

      for (const id of rows[t]) {
        const n = byId.get(id);
        const x = left(id), y = rowTop[t];
        const g = el("g", {
          class: "node",
          tabindex: "0",
          role: "listitem",
          "data-id": id,
          "aria-label": describe(id),
        }, nodeLayer);
        nodeEls.set(id, g);
        stamp(el("rect", { class: "fill", x, y, width: BW, height: BH }, g));
        stroke(el("path", { class: "ink", d: rect(x, y, BW, BH) }, g), true);
        if (name === "Core") {
          const hatch = [];
          for (let k = x - BH; k < x + BW; k += 7) {
            const x0 = Math.max(k, x + 3), x1 = Math.min(k + BH, x + BW - 3);
            if (x1 > x0) hatch.push(`M${f(x0)} ${f(y + BH - (x0 - k))}L${f(x1)} ${f(y + BH - (x1 - k))}`);
          }
          stroke(el("path", { class: "hatch", d: hatch.join("") }, g));
        }
        wipe(write(id, { class: "nm knock", x: cx.get(id), y: y + 17, "text-anchor": "middle" }, g), { perChar: 20 });
        wipe(write(n.path, { class: "pt knock", x: cx.get(id), y: y + 31, "text-anchor": "middle" }, g), { together: true });

        for (const e of edges.filter((edge) => edge.from === id)) {
          const eg = el("g", { class: "edge" }, edgeLayer);
          edgeEls.push({ e, g: eg });
          stroke(el("path", { class: "lead", d: ruled(e.pts) }, eg));
          stamp(el("path", { class: "head", d: arrowHead(e.pts.at(-2), e.pts.at(-1)) }, eg));
        }
      }
    }

    const entryRows = byId.get(rows[0][0]).kind === "entry" ? 1 : 0;
    if (entryRows) {
      const first = left(rows[0][0]), end = left(rows[0].at(-1)) + BW, dy = TOP - 34;
      stroke(el("path", { class: "fine", d: `M${f(first)} ${TOP - 6}V${dy - 6}M${f(end)} ${TOP - 6}V${dy - 6}` }, noteLayer));
      stroke(el("path", { class: "lead", d: ruled([[first, dy], [end, dy]]) }, noteLayer));
      stamp(el("path", { class: "head", d: arrowHead([first + 20, dy], [first, dy]) + arrowHead([end - 20, dy], [end, dy]) }, noteLayer));
      dimension(`${nodes.length - packages.length} entry points`, f((first + end) / 2), dy);
    }

    if (packages.length) {
      const dx = W - R + 26, y0 = rowTop[entryRows], y1 = rowTop[last] + BH;
      const right = Math.max(...rows.slice(entryRows).map((row) => left(row.at(-1)) + BW)) + 6;
      stroke(el("path", { class: "fine", d: `M${f(right)} ${y0}H${dx + 6}M${f(right)} ${y1}H${dx + 6}` }, noteLayer));
      stroke(el("path", { class: "lead", d: ruled([[dx, y0], [dx, y1]]) }, noteLayer));
      stamp(el("path", { class: "head", d: arrowHead([dx, y0 + 20], [dx, y0]) + arrowHead([dx, y1 - 20], [dx, y1]) }, noteLayer));
      dimension(`${packages.length} packages`, dx, f((y0 + y1) / 2), true);
    }

    const ny = rowTop[last] + BH + 36;
    wipe(write("Notes", { class: "lbl", x: 26, y: ny }, noteLayer), { perChar: 18 });
    [
      "1. Arrows point at what a package imports.",
      "2. An import another arrow implies is left off.",
      rows.some((_, t) => blurb(t)[0] === "Core") ? "3. Hatched: the core layer." : "",
    ].filter(Boolean).forEach((line, i) => {
      wipe(write(line, { class: "note", x: 26, y: ny + 14 + i * 12 }, noteLayer), { together: i > 0, perChar: 7 });
    });

    wipe(write("Source", { class: "note", x: tb.x + 8, y: tb.y + 37 }, noteLayer), { perChar: 12 });
    wipe(write(`${nodes.length} × package.json`, { class: "lbl-sub", x: tb.x + 78, y: tb.y + 37 }, noteLayer), { together: true });
    wipe(write("Drawn by", { class: "note", x: tb.x + 8, y: tb.y + 56 }, noteLayer), { perChar: 12 });
    wipe(write("pnpm docs:map", { class: "lbl-sub", x: tb.x + 78, y: tb.y + 56 }, noteLayer), { together: true });
    wipe(write("LintCat · architecture", { class: "ttl", x: tb.x + tb.w / 2, y: tb.y + 16, "text-anchor": "middle" }, noteLayer), { perChar: 24 });
    say(`${nodes.length} packages in ${rows.length} layers. Hover, tap or tab to a box to trace its imports.`);
  }

  const nodeEls = new Map();
  const edgeEls = [];
  const list = (ids) => (ids.length ? ids.join(", ") : "nothing in the workspace");
  function describe(id) {
    const n = byId.get(id);
    return `${n.name} — ${n.description.replace(/\.$/, "")}. Imports ${list(n.imports)}; imported by ${list(n.importedBy)}.`;
  }

  let drawing = false, raf = 0, idleCaption = "";
  const nib = el("circle", { class: "nib", r: 2.4, visibility: "hidden" });
  const bar = document.createElement("div");
  bar.className = "flow-bar";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "flow-replay";
  bar.append(button);

  function render(t) {
    let head = null;
    for (const step of plan) {
      const p = step.dur ? Math.min(1, Math.max(0, (t - step.at) / step.dur)) : t >= step.at ? 1 : 0;
      if (p !== step.p) step.draw(p);
      step.p = p;
      if (p > 0 && p < 1 && step.nib) head = step.nib(p);
    }
    nib.setAttribute("visibility", head ? "visible" : "hidden");
    if (head) {
      nib.setAttribute("cx", f(head.x));
      nib.setAttribute("cy", f(head.y));
    }
  }
  function finish() {
    cancelAnimationFrame(raf);
    render(Infinity);
    drawing = false;
    idleCaption = caption.textContent;
    button.textContent = "Redraw";
  }
  function play() {
    if (reduced.matches) return finish();
    cancelAnimationFrame(raf);
    trace(null);
    drawing = true;
    button.textContent = "Skip";
    const t0 = performance.now();
    const tick = (now) => {
      render(now - t0);
      if (now - t0 < at) raf = requestAnimationFrame(tick);
      else finish();
    };
    render(0);
    raf = requestAnimationFrame(tick);
  }
  button.addEventListener("click", () => (drawing ? finish() : play()));

  function trace(id) {
    if (drawing) return;
    const n = id ? byId.get(id) : null;
    svg.classList.toggle("is-tracing", Boolean(n));
    for (const [other, g] of nodeEls) {
      g.classList.toggle("is-focus", other === id);
      g.classList.toggle("is-dep", Boolean(n?.imports.includes(other)));
      g.classList.toggle("is-user", Boolean(n?.importedBy.includes(other)));
    }
    for (const { e, g } of edgeEls) g.classList.toggle("is-hot", e.from === id || e.to === id);
    caption.textContent = n ? describe(id) : idleCaption;
  }
  const focusedNode = () => document.activeElement?.closest?.(".bp .node")?.dataset.id ?? null;
  nodeLayer.addEventListener("pointerover", (event) => trace(event.target.closest(".node")?.dataset.id ?? null));
  nodeLayer.addEventListener("pointerleave", () => trace(focusedNode()));
  nodeLayer.addEventListener("focusin", () => trace(focusedNode()));
  nodeLayer.addEventListener("focusout", () => requestAnimationFrame(() => trace(focusedNode())));

  document.fonts.ready.then(() => {
    build();
    svg.append(nib);
    caption.after(bar);
    render(0);
    if (reduced.matches || !("IntersectionObserver" in window)) return finish();
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        io.disconnect();
        play();
      },
      { threshold: 0.25 },
    );
    io.observe(svg);
  });

  const minimap = document.querySelector("[data-minimap]");
  if (!minimap) return;
  const chips = new Map();
  const mm = minimap.querySelector(".mm");
  for (const row of rows) {
    const div = document.createElement("div");
    div.className = "mm-row";
    for (const id of row) {
      const chip = document.createElement("span");
      chip.className = "mm-node";
      chip.textContent = id;
      chips.set(id, chip);
      div.append(chip);
    }
    mm.append(div);
  }
  minimap.hidden = false;

  const ownersOf = (els) =>
    [...els].flatMap((e) => {
      const text = e.textContent.trim();
      return nodes.filter((n) => text.startsWith(`${n.path}/`)).map((n) => n.id);
    });
  const sections = [...document.querySelectorAll("main > header, main > section")];
  const owners = new Map(sections.map((s) => [s, new Set(ownersOf(s.querySelectorAll(".chip, .code-head .p")))]));
  let group = [];
  for (const tr of document.querySelector("#map tbody")?.rows ?? []) {
    const heading = tr.querySelector("th")?.textContent.match(/^(\d+)(?:\s*[–-]\s*(\d+))?/);
    if (tr.querySelector("th")) {
      const [from, to] = heading ? [Number(heading[1]), Number(heading[2] ?? heading[1])] : [1, 0];
      group = Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => document.getElementById(`s${from + i}`));
      continue;
    }
    for (const id of ownersOf(tr.querySelectorAll("td:first-child code"))) {
      for (const section of group) owners.get(section)?.add(id);
    }
  }

  const now = minimap.querySelector(".mm-now");
  const railLinks = [...document.querySelectorAll(".rail a[href^='#']")];
  function show(section) {
    const ids = owners.get(section) ?? new Set();
    for (const [id, chip] of chips) chip.classList.toggle("is-on", ids.has(id));
    const num = section.querySelector(".stage-head .stage-num")?.textContent.trim();
    const title = section.querySelector(".stage-head h2")?.textContent.trim();
    const head = document.createElement("b");
    head.textContent = title ? `${num === "—" ? "" : `${num} · `}${title}` : "";
    now.replaceChildren(head, title ? (ids.size ? [...ids].join(" · ") : "Across the codebase") : "Each stage lights the packages it runs in.");
    for (const a of railLinks) {
      if (a.getAttribute("href") === `#${section.id}`) a.setAttribute("aria-current", "true");
      else a.removeAttribute("aria-current");
    }
  }
  show(sections[0]);
  const spy = new IntersectionObserver(
    (entries) => entries.filter((entry) => entry.isIntersecting).forEach((entry) => show(entry.target)),
    { rootMargin: "-40% 0px -59% 0px" },
  );
  sections.forEach((s) => spy.observe(s));
})();
