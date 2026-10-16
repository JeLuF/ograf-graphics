// DTB Wheel of Fortune - OGraf web component
const LINES = 15;
const KEYS = ["title", "position", "layout", "spinDuration"];
for (let i = 1; i <= LINES; i++) KEYS.push(`line${i}`);
const POSITIONS = ["left", "center", "right"];

// Colours used for lines without an explicit #color (cycled in order)
const PALETTE = ["#e30613", "#f2a900", "#2a6ebb", "#3aa655", "#8e44ad", "#ee7c1a", "#00a0b0", "#c2185b", "#6d6e71", "#1d1d1b"];

const LOGO = `<svg viewBox="0 0 100 100" aria-label="DTB Turnerkreuz"><defs><path id="f" d="M0 0H44V11H12V18H34V29H12V46H0Z"/></defs><use href="#f" transform="translate(46 46) scale(-1 -1)"/><use href="#f" transform="translate(54 46) scale(1 -1)"/><use href="#f" transform="translate(46 54) scale(-1 1)"/><use href="#f" transform="translate(54 54)"/></svg>`;

const COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

// "count #color text" -> { count, color|null, text } ; null for empty/invalid lines.
// If the word after the count starts with "#", it is the colour; otherwise it is the beginning of the text.
function parseLine(raw) {
  const m = String(raw ?? "").trim().match(/^(\d+)\s*(.*)$/s);
  if (!m) return null;
  const count = parseInt(m[1], 10);
  if (!(count > 0)) return null;
  let rest = m[2].trim(), color = null;
  if (rest.startsWith("#")) {
    const mm = rest.match(/^(#\S*)\s*(.*)$/s);
    color = COLOR_RE.test(mm[1]) ? mm[1] : null; // invalid colour -> palette colour, token is still consumed
    rest = mm[2].trim();
  }
  return { count, color, text: rest };
}

// Parses the 15 input lines into outcomes { count, color, text }.
function buildOutcomes(data) {
  const parsed = [];
  for (let i = 1; i <= LINES; i++) {
    const p = parseLine(data[`line${i}`]);
    if (p) parsed.push(p);
  }
  // Lines without a colour get palette colours, skipping ones that were set explicitly elsewhere
  const used = new Set(parsed.filter((p) => p.color).map((p) => p.color.toLowerCase()));
  const free = PALETTE.filter((c) => !used.has(c));
  const pool = free.length ? free : PALETTE;
  let poolIdx = 0;
  return parsed.map((p, n) => ({
    count: p.count,
    color: p.color || pool[poolIdx++ % pool.length],
    text: p.text || `Option ${n + 1}`,
  }));
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
  const outcomes = buildOutcomes(data);
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
  return { outcomes, slices };
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

const TEMPLATE = `
<style>
  :host { position: absolute; inset: 0; display: block; overflow: hidden;
          pointer-events: none; font-family: "Helvetica Neue", Arial, sans-serif; }
  .card {
    position: absolute; top: 0; bottom: 0; height: fit-content; margin: auto 0; width: 30vw;
    box-sizing: border-box; padding: 1.4vw 1.6vw 1.5vw;
    background: #fff; color: #000; box-shadow: 0 0.3vw 1vw rgba(0,0,0,.35);
    opacity: 0; transition: transform .6s cubic-bezier(.2,.8,.2,1), opacity .4s ease;
  }
  .card.left   { left: 3%;  transform: translateX(-130%); }
  .card.right  { right: 3%; transform: translateX(130%); }
  .card.center { left: 0; right: 0; margin: auto; transform: translateY(8vw) scale(.92); }
  .card.visible { opacity: 1; transform: none; }
  .card.instant { transition: none; }
  .header { display: flex; align-items: center; gap: 1vw; }
  .logo svg { width: 3.2vw; height: 3.2vw; display: block; fill: #e30613; }
  .title { font-size: 2vw; font-weight: 800; line-height: 1.1; }
  .wheelwrap { position: relative; width: 19vw; height: 19vw; margin: 1.6vw auto .8vw; }
  .wheel { width: 100%; height: 100%; display: block; transform-origin: 50% 50%; }
  .pointer { position: absolute; left: 50%; top: -1.3vw; width: 2.6vw; height: 2.6vw; margin-left: -1.3vw;
             fill: #e30613; stroke: #fff; stroke-width: 3; stroke-linejoin: round;
             filter: drop-shadow(0 .1vw .2vw rgba(0,0,0,.4)); }
  .result { display: flex; align-items: center; justify-content: center; gap: .7vw; margin: .6vw 0 .2vw;
            padding: .5vw .8vw; border: .15vw solid #000; font-size: 1.7vw; font-weight: 800; line-height: 1.15; }
  .result.hidden { display: none; }
  .rsw { flex: none; width: 1.5vw; height: 1.5vw; border-radius: .3vw; border: .08vw solid #000; }
  .rtxt { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .legend { margin-top: .9vw; padding-top: .8vw; border-top: .08vw solid #cfcfcf; column-gap: 1.2vw; }
  .item { display: flex; align-items: center; gap: .6vw; margin-bottom: .45vw; break-inside: avoid;
          font-size: 1.15vw; line-height: 1.2; transition: opacity .4s ease; }
  .sw { flex: none; width: 1.2vw; height: 1.2vw; border-radius: .25vw; border: .07vw solid rgba(0,0,0,.5); }
  .txt { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .legend.done .item { opacity: .35; }
  .legend.done .item.win { opacity: 1; font-weight: 800; }
</style>
<div class="card right">
  <div class="header"><div class="logo">${LOGO}</div><div class="title"></div></div>
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

  _applyPosition() {
    const p = String(this.data.position ?? "").trim().toLowerCase();
    const pos = POSITIONS.includes(p) ? p : "right";
    this.card.classList.remove(...POSITIONS);
    this.card.classList.add(pos);
  }

  _render() {
    const $ = (sel) => this.shadowRoot.querySelector(sel);
    this._applyPosition();
    $(".title").textContent = this.data.title ?? "";
    ({ outcomes: this.outcomes, slices: this.slices } = buildWheel(this.data));

    // wheel
    const R = 98;
    let svg = "";
    if (this.slices.length === 0) {
      svg += `<circle r="${R}" fill="#e6e6e6"/>`;
    } else if (this.slices.length === 1) {
      svg += `<circle r="${R}" fill="${this.slices[0].color}"/>`;
    } else {
      for (const s of this.slices) {
        svg += `<path d="${sectorPath(s.start, s.size, R)}" fill="${s.color}" stroke="#fff" stroke-width="0.8"/>`;
      }
    }
    svg += `<circle r="${R}" fill="none" stroke="#000" stroke-width="1.2"/>`
         + `<circle r="10" fill="#fff" stroke="#000" stroke-width="1.2"/><circle r="4" fill="#e30613"/>`;
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
