// Step-through animation for any element carrying data-flow.
// Children opt in with data-step="3" (or "3 5 7" to re-fire on each of those).
(() => {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");

  class Flow {
    constructor(root) {
      this.root = root;
      this.parts = [...root.querySelectorAll("[data-step]")].map((el) => ({
        el,
        steps: el.dataset.step.trim().split(/\s+/).map(Number),
      }));
      this.last = Math.max(...this.parts.flatMap((p) => p.steps));
      this.caption = root.querySelector("[data-flow-caption]");
      this.timer = 0;
      this.played = false;
      this.buildControls();
    }

    buildControls() {
      const bar = document.createElement("div");
      bar.className = "flow-bar";
      this.button = document.createElement("button");
      this.button.type = "button";
      this.button.className = "flow-replay";
      this.button.textContent = "Play";
      this.button.addEventListener("click", () => this.play());
      bar.append(this.button);
      (this.caption?.parentElement ?? this.root).append(bar);
    }

    holdFor(step) {
      let hold = 0;
      for (const p of this.parts) {
        if (!p.steps.includes(step)) continue;
        const own = Number(p.el.dataset.hold);
        const dflt = p.el.matches(".edge-g") ? 240 : 640;
        hold = Math.max(hold, Number.isFinite(own) && own > 0 ? own : dflt);
      }
      return hold || 240;
    }

    reset() {
      clearTimeout(this.timer);
      this.root.classList.add("is-flowing");
      for (const p of this.parts) {
        p.el.classList.remove("is-on", "is-now");
        for (const a of p.el.querySelectorAll("animateMotion")) a.endElement();
      }
      if (this.caption) this.caption.textContent = "";
    }

    finish() {
      this.root.classList.remove("is-flowing");
      for (const p of this.parts) p.el.classList.remove("is-now");
      this.button.disabled = false;
      this.button.textContent = "Replay";
    }

    play() {
      if (reduced.matches) return;
      this.played = true;
      this.button.disabled = true;
      this.reset();
      const tick = (step) => {
        for (const p of this.parts) {
          const now = p.steps.includes(step);
          p.el.classList.remove("is-now");
          if (!now) continue;
          void p.el.offsetWidth; // restart the pulse when a step re-fires
          p.el.classList.add("is-on", "is-now");
          for (const a of p.el.querySelectorAll("animateMotion")) a.beginElement();
          if (p.el.dataset.caption && this.caption) {
            this.caption.textContent = p.el.dataset.caption;
          }
        }
        if (step >= this.last) {
          this.timer = setTimeout(() => this.finish(), 900);
          return;
        }
        this.timer = setTimeout(() => tick(step + 1), this.holdFor(step));
      };
      tick(1);
    }
  }

  const flows = [...document.querySelectorAll("[data-flow]")].map((el) => new Flow(el));
  if (!("IntersectionObserver" in window)) return;
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const flow = flows.find((f) => f.root === entry.target);
        if (flow && !flow.played) flow.play();
        io.unobserve(entry.target);
      }
    },
    { threshold: 0.3 },
  );
  for (const f of flows) io.observe(f.root);
})();
