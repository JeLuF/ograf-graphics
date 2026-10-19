// DTB Wheel of Fortune - OGraf web component
const MAX_OUTCOMES = 15;
const KEYS = ["logo", "theme", "backgroundColor", "textColor", "accentColor", "title", "position", "layout", "spinDuration", "outcomes"];
const POSITIONS = ["left", "center", "right"];

// Fallback colours, used only if the theme stylesheet does not define a colour (e.g. it failed to load)
const PALETTE = ["#e30613", "#f2a900", "#2a6ebb", "#3aa655", "#8e44ad", "#ee7c1a", "#00a0b0", "#c2185b", "#6d6e71", "#1d1d1b"];

const DEFAULT_LOGO = "./assets/logo.svg";
// Colour theme: a stylesheet defining .ramp-2 ... .ramp-15, each with --c1 ... --cN for a wheel with N outcomes.
const DEFAULT_THEME = "./assets/rainbow.css";
const MAX_RAMP = 15;
// Asset path from a field, resolved relative to this module (absolute URLs pass through).
function assetUrl(path, fallback) {
  try { return new URL(String(path || fallback), import.meta.url).href; }
  catch { return new URL(fallback, import.meta.url).href; }
}

// Outcomes array [{ count, label }] -> outcomes { count, color, text } and the theme ramp size.
// Entries without a valid count (> 0) are skipped; colours come from the theme ramp, in array order.
function buildOutcomes(data) {
  const list = Array.isArray(data.outcomes) ? data.outcomes : [];
  const parsed = [];
  for (const e of list) {
    const count = Math.floor(Number(e?.count));
    if (count > 0) parsed.push({ count, text: String(e?.label ?? "").trim() });
    if (parsed.length >= MAX_OUTCOMES) break;
  }
  const ramp = Math.min(Math.max(parsed.length, 2), MAX_RAMP);
  const outcomes = parsed.map((p, n) => {
    const k = n + 1;
    return { count: p.count, color: `var(--c${k}, ${PALETTE[(k - 1) % PALETTE.length]})`, text: p.text || `Option ${k}` };
  });
  return { outcomes, ramp };
}

const conflicts = (arr) => {
  let n = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i] === arr[(i + 1) % arr.length]) n++;
  return n;
};

// Fill positions 0,2,4,... then 1,3,5,... with the outcomes sorted by count (largest first).
// Guarantees no equal neighbours (also around the wrap) when the largest count <= floor(N/2).
function arrangeEvenOdd(counts) {
  const N = counts.reduce((a, b) => a + b, 0);
  const order = counts.map((c, o) => [c, o]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const arr = new Array(N);
  let pos = 0;
  for (const [c, o] of order) for (let j = 0; j < c; j++) { if (pos >= N) pos = 1; arr[pos] = o; pos += 2; }
  return arr;
}

// Spreads each outcome's slices evenly around the wheel, then swaps slices to remove equal neighbours.
// Returns an array of outcome indices, one per slice, in wheel order (clockwise from the top).
function arrangeDistributed(counts) {
  const N = counts.reduce((a, b) => a + b, 0);
  if (counts.length < 2) return new Array(N).fill(0);
  const items = [];
  counts.forEach((c, o) => {
    const offset = (o * 0.618034) % 1;
    for (let j = 0; j < c; j++) items.push({ t: ((j + offset) * N) / c, o });
  });
  items.sort((a, b) => a.t - b.t || a.o - b.o);
  const arr = items.map((x) => x.o);
  // repair: swap one slice of each conflicting pair with another slice if that reduces the conflicts
  for (let guard = 0; guard < N * 4 && conflicts(arr) > 0; guard++) {
    let i = -1;
    for (let x = 0; x < N; x++) if (arr[x] === arr[(x + 1) % N]) { i = x; break; }
    const a = (i + 1) % N;
    const before = conflicts(arr);
    let fixed = false;
    for (let d = 1; d < N && !fixed; d++) {
      const j = (a + d) % N;
      if (arr[j] === arr[a]) continue;
      [arr[a], arr[j]] = [arr[j], arr[a]];
      if (conflicts(arr) < before) fixed = true;
      else [arr[a], arr[j]] = [arr[j], arr[a]];
    }
    if (!fixed) break;
  }
  if (conflicts(arr) === 0) return arr;
  const alt = arrangeEvenOdd(counts);
  return conflicts(alt) < conflicts(arr) ? alt : arr; // on a tie keep the more evenly spread arrangement
}

const MAX_SLICES = 360; // distributed layout needs one slice per share; beyond this the wheel falls back to proportional

// Builds the wheel: outcomes (legend) and slices (what is drawn and what the pointer can land on).
// Angles are degrees clockwise from the top; weight = relative chance of the slice.
function buildWheel(data) {
  const { outcomes, ramp } = buildOutcomes(data);
  const total = outcomes.reduce((s, o) => s + o.count, 0);
  const distributed = String(data.layout ?? "").trim().toLowerCase() === "distributed"
    && outcomes.length > 0 && total <= MAX_SLICES;
  let slices;
  if (distributed) {
    const size = 360 / total;
    slices = arrangeDistributed(outcomes.map((o) => o.count)).map((o, i) => ({
      outcome: o, color: outcomes[o].color, start: i * size, size, weight: 1,
    }));
  } else {
    let start = 0;
    slices = outcomes.map((o, i) => {
      const size = (o.count / total) * 360;
      const sl = { outcome: i, color: o.color, start, size, weight: o.count };
      start += size;
      return sl;
    });
  }
  return { outcomes, slices, ramp };
}

function sectorPath(start, size, R) {
  const p = (deg) => {
    const t = (deg * Math.PI) / 180;
    return `${(R * Math.sin(t)).toFixed(3)},${(-R * Math.cos(t)).toFixed(3)}`;
  };
  return `M0,0 L${p(start)} A${R},${R} 0 ${size > 180 ? 1 : 0} 1 ${p(start + size)} Z`;
}

// Picks a slice (probability proportional to its weight) and the extra rotation needed
// to bring a random spot inside that slice under the pointer at the top.
function planSpin(slices, currentRotation, rand = Math.random) {
  const total = slices.reduce((s, x) => s + x.weight, 0);
  let r = rand() * total, idx = 0;
  for (; idx < slices.length - 1; idx++) {
    if (r < slices[idx].weight) break;
    r -= slices[idx].weight;
  }
  const s = slices[idx];
  const a = s.start + (0.1 + 0.8 * rand()) * s.size; // stay away from the slice edges
  const turns = 5 + Math.floor(rand() * 3);
  const delta = turns * 360 + ((360 - ((a + currentRotation) % 360)) % 360);
  return { idx, delta };
}

// Colour fields -> CSS custom properties on the host; invalid or empty values fall back to the defaults in :host.
const COLORS = { backgroundColor: "--bg", textColor: "--fg", accentColor: "--accent" };
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
function applyColors(el, data) {
  for (const [key, prop] of Object.entries(COLORS)) {
    const c = String(data?.[key] ?? "").trim();
    if (HEX_RE.test(c)) el.style.setProperty(prop, c); else el.style.removeProperty(prop);
  }
}

const TEMPLATE = `
<style>
  :host { position: absolute; inset: 0; display: block; overflow: hidden;
          pointer-events: none; font-family: "Helvetica Neue", Arial, sans-serif; --bg: #fff; --fg: #000; --accent: #e30613; }
  .card {
    position: absolute; top: 0; bottom: 0; height: fit-content; margin: auto 0; width: 30vw;
    box-sizing: border-box; padding: 1.4vw 1.6vw 1.5vw;
    background: var(--bg); color: var(--fg); box-shadow: 0 0.3vw 1vw rgba(0,0,0,.35);
    opacity: 0; transition: transform .6s cubic-bezier(.2,.8,.2,1), opacity .4s ease;
  }
  .card.left   { left: 3%;  transform: translateX(-130%); }
  .card.right  { right: 3%; transform: translateX(130%); }
  .card.center { left: 0; right: 0; margin: auto; transform: translateY(8vw) scale(.92); }
  .card.visible { opacity: 1; transform: none; }
  .card.instant { transition: none; }
  .header { display: flex; align-items: center; gap: 1vw; }
  .logo img { width: 3.2vw; height: 3.2vw; display: block; object-fit: contain; }
  .title { font-size: 2vw; font-weight: 800; line-height: 1.1; }
  .wheelwrap { position: relative; width: 19vw; height: 19vw; margin: 1.6vw auto .8vw; }
  .wheel { width: 100%; height: 100%; display: block; transform-origin: 50% 50%; }
  .pointer { position: absolute; left: 50%; top: -1.3vw; width: 2.6vw; height: 2.6vw; margin-left: -1.3vw;
             fill: var(--accent); stroke: var(--bg); stroke-width: 3; stroke-linejoin: round;
             filter: drop-shadow(0 .1vw .2vw rgba(0,0,0,.4)); }
  .result { display: flex; align-items: center; justify-content: center; gap: .7vw; margin: .6vw 0 .2vw;
            padding: .5vw .8vw; border: .15vw solid var(--fg); font-size: 1.7vw; font-weight: 800; line-height: 1.15; }
  .result.hidden { display: none; }
  .rsw { flex: none; width: 1.5vw; height: 1.5vw; border-radius: .3vw; border: .08vw solid var(--fg); }
  .rtxt { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .legend { margin-top: .9vw; padding-top: .8vw; border-top: .08vw solid color-mix(in srgb, var(--fg) 19%, var(--bg)); column-gap: 1.2vw; }
  .item { display: flex; align-items: center; gap: .6vw; margin-bottom: .45vw; break-inside: avoid;
          font-size: 1.15vw; line-height: 1.2; transition: opacity .4s ease; }
  .sw { flex: none; width: 1.2vw; height: 1.2vw; border-radius: .25vw; border: .07vw solid color-mix(in srgb, var(--fg) 50%, transparent); }
  .txt { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .legend.done .item { opacity: .35; }
  .legend.done .item.win { opacity: 1; font-weight: 800; }
</style>
<link rel="stylesheet" class="theme">
<div class="card right">
  <div class="header"><div class="logo"><img alt=""></div><div class="title"></div></div>
  <div class="wheelwrap">
    <svg class="wheel" viewBox="-100 -100 200 200"></svg>
    <svg class="pointer" viewBox="0 0 40 40"><path d="M3 3 H37 L20 37 Z"/></svg>
  </div>
  <div class="result hidden"><span class="rsw"></span><span class="rtxt"></span></div>
  <div class="legend"></div>
</div>
`;

export default class DtbWheelOfFortune extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = TEMPLATE;
    this.card = this.shadowRoot.querySelector(".card");
    this.wheel = this.shadowRoot.querySelector(".wheel");
    this.data = { title: "", position: "right", layout: "proportional", spinDuration: "6" };
    this.outcomes = [];
    this.slices = [];
    this.rotation = 0;
    this.visible = false;
    this.spinning = false;
    this.winner = -1;
    this.pending = null;
    this.timer = null;
    this._render();
  }

  _applyLogo() {
    const url = assetUrl(this.data.logo, DEFAULT_LOGO);
    for (const img of this.shadowRoot.querySelectorAll(".logo img")) if (img.src !== url) img.src = url;
  }

  _applyTheme(ramp) {
    const link = this.shadowRoot.querySelector("link.theme");
    const url = assetUrl(this.data.theme, DEFAULT_THEME);
    if (link.href !== url) link.href = url;
    this.card.classList.remove(...[...this.card.classList].filter((c) => c.startsWith("ramp-")));
    this.card.classList.add(`ramp-${ramp}`);
  }

  _applyPosition() {
    const p = String(this.data.position ?? "").trim().toLowerCase();
    const pos = POSITIONS.includes(p) ? p : "right";
    this.card.classList.remove(...POSITIONS);
    this.card.classList.add(pos);
  }

  _render() {
    const $ = (sel) => this.shadowRoot.querySelector(sel);
    this._applyPosition();
    this._applyLogo();
    applyColors(this, this.data);
    $(".title").textContent = this.data.title ?? "";
    const wheel = buildWheel(this.data);
    ({ outcomes: this.outcomes, slices: this.slices } = wheel);
    this._applyTheme(wheel.ramp);

    // wheel
    const R = 98;
    let svg = "";
    if (this.slices.length === 0) {
      svg += `<circle r="${R}" style="fill: color-mix(in srgb, var(--fg) 10%, var(--bg))"/>`;
    } else if (this.slices.length === 1) {
      svg += `<circle r="${R}" style="fill: ${this.slices[0].color}"/>`;
    } else {
      for (const s of this.slices) {
        svg += `<path d="${sectorPath(s.start, s.size, R)}" style="fill: ${s.color}; stroke: var(--bg)" stroke-width="0.8"/>`;
      }
    }
    svg += `<circle r="${R}" fill="none" style="stroke: var(--fg)" stroke-width="1.2"/>`
         + `<circle r="10" style="fill: var(--bg); stroke: var(--fg)" stroke-width="1.2"/><circle r="4" style="fill: var(--accent)"/>`;
    this.wheel.innerHTML = svg;

    // legend
    const legend = $(".legend");
    legend.replaceChildren(...this.outcomes.map((s) => {
      const item = document.createElement("div");
      item.className = "item";
      const sw = document.createElement("span");
      sw.className = "sw";
      sw.style.background = s.color;
      const txt = document.createElement("span");
      txt.className = "txt";
      txt.textContent = s.text;
      item.append(sw, txt);
      return item;
    }));
    legend.style.columnCount = this.outcomes.length > 6 ? 2 : 1;
    legend.style.display = this.outcomes.length ? "" : "none";
    this._renderResult();
  }

  _renderResult() {
    const $ = (sel) => this.shadowRoot.querySelector(sel);
    const win = this.outcomes[this.winner];
    const box = $(".result");
    box.classList.toggle("hidden", !win);
    if (win) {
      $(".rsw").style.background = win.color;
      $(".rtxt").textContent = win.text;
    }
    const legend = $(".legend");
    legend.classList.toggle("done", !!win);
    [...legend.children].forEach((el, i) => el.classList.toggle("win", i === this.winner));
  }

  _merge(data) {
    if (this.spinning) { // don't change the wheel while it turns; apply afterwards
      this.pending = { ...(this.pending ?? {}), ...(data ?? {}) };
      return;
    }
    if (data && typeof data === "object") for (const k of KEYS) if (k in data) this.data[k] = data[k];
    this.winner = -1;
    this._render();
  }

  _spin() {
    if (this.spinning || this.slices.length === 0) return;
    const n = Number(String(this.data.spinDuration ?? "").replace(",", "."));
    const seconds = Number.isFinite(n) && n >= 1 ? Math.min(n, 30) : 6;
    const { idx, delta } = planSpin(this.slices, this.rotation);
    this.spinning = true;
    this.winner = -1;
    this._renderResult();
    this.rotation += delta;
    this.wheel.style.transition = `transform ${seconds}s cubic-bezier(.12,.6,.1,1)`;
    this.wheel.style.transform = `rotate(${this.rotation}deg)`;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this._finishSpin(this.slices[idx].outcome), seconds * 1000 + 150);
  }

  _finishSpin(outcomeIdx) {
    this.spinning = false;
    if (this.pending) { // data arrived during the spin: apply it now, keep the winner only if nothing changed
      const pending = this.pending;
      this.pending = null;
      this._merge(pending);
      return;
    }
    this.winner = outcomeIdx;
    this._renderResult();
  }

  _show(skip) {
    this.visible = true;
    this.winner = -1;
    this._renderResult();
    this.card.classList.toggle("instant", !!skip);
    void this.card.offsetWidth;
    this.card.classList.add("visible");
  }

  _hide(skip) {
    this.visible = false;
    this.card.classList.toggle("instant", !!skip);
    void this.card.offsetWidth;
    this.card.classList.remove("visible");
    // once it has slid out: stop any spin, clear the result, apply queued data
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.visible) return;
      this.spinning = false;
      this.winner = -1;
      const pending = this.pending;
      this.pending = null;
      if (pending) this._merge(pending); else this._renderResult();
    }, skip ? 0 : 700);
  }

  async load(params) {
    this._merge(params?.data);
    return { statusCode: 200 };
  }

  async dispose() {
    clearTimeout(this.timer);
    this.shadowRoot.innerHTML = "";
    return { statusCode: 200 };
  }

  async updateAction(params) {
    this._merge(params?.data);
    return { statusCode: 200 };
  }

  // First play shows the wheel; every further play (the next step) spins it.
  async playAction(params) {
    if (!this.visible) this._show(params?.skipAnimation);
    else this._spin();
    return { statusCode: 200 };
  }

  async stopAction(params) {
    this._hide(params?.skipAnimation);
    return { statusCode: 200 };
  }

  async customAction(params) {
    if (params?.id === "spin") {
      if (!this.visible) {
        this._show(params?.skipAnimation);
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this._spin(), params?.skipAnimation ? 0 : 800);
      } else {
        this._spin();
      }
      return { statusCode: 200 };
    }
    return { statusCode: 404, statusMessage: `Unknown action: ${params?.id}` };
  }
}
