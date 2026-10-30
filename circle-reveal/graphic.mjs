// Circle Image Reveal - OGraf web component (one step: play reveals the image and keeps it, stop takes it away again).
//
// N circles fly in from the side, pulsing in size while they move. The full-screen image is only visible inside the
// circles. Once the circles are spread out evenly they grow until the whole image is visible. Stop plays the same
// sequence backwards, with the circles leaving towards the chosen exit side. play/stop resolve when their animation has finished.
const KEYS = ["image", "imageFit", "backgroundColor", "circleCount", "startRadius", "side", "exitSide", "flySeconds", "growSeconds", "overlapSeconds"];
const STEP_COUNT = 1;
const REF_WIDTH = 1920;  // startRadius is entered in pixels for a 1920 px wide screen and scales with the screen

const num = (v, fallback, min, max) => {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const clamp01 = (k) => Math.min(1, Math.max(0, k));
const easeOutCubic = (k) => 1 - Math.pow(1 - k, 3);
const easeInOutCubic = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const easeInOutQuad = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
const easeOutBack = (k) => { const c1 = 0.9, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };
// deterministic pseudo random number in 0..1 (the circles fly the same way on every run)
const rand = (i, salt) => { const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453; return x - Math.floor(x); };

// ------------------------------------------------------------------------------------------------ layout
// Spreads n points evenly over the screen: rows of (nearly) equal count, odd rows shifted by half a cell.
function layoutCenters(n, W, H) {
  const cols = Math.max(1, Math.min(n, Math.round(Math.sqrt((n * W) / H))));
  const rows = Math.ceil(n / cols);
  const base = Math.floor(n / rows), extra = n % rows;
  const pts = [];
  for (let r = 0; r < rows; r++) {
    const count = base + (r < extra ? 1 : 0);
    const cell = W / count;
    const shift = count > 1 ? (r % 2 ? 0.75 : 0.25) : 0.5;
    for (let j = 0; j < count; j++) pts.push([(j + (count > 1 ? shift : 0.5)) * cell, ((r + 0.5) * H) / rows]);
  }
  return pts;
}

// Smallest radius at which circles of equal size around the given centres cover the whole screen
// (sampled every 10 px plus a small safety margin, so no corner stays uncovered).
function coverRadius(centers, W, H) {
  const step = 10;
  let worst = 0;
  for (let y = 0; y <= H + step - 1e-6; y += step) {
    const py = Math.min(y, H);
    for (let x = 0; x <= W + step - 1e-6; x += step) {
      const px = Math.min(x, W);
      let best = Infinity;
      for (const [cx, cy] of centers) { const d = Math.hypot(px - cx, py - cy); if (d < best) best = d; }
      if (best > worst) worst = best;
    }
  }
  return worst + step;
}

const color = (v, fallback) => {
  const t = String(v ?? "").trim();
  return /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(t) || t.toLowerCase() === "transparent" ? t : fallback;
};
const parseFit = (v) => {
  const t = String(v ?? "").trim().toLowerCase();
  return ["stretch", "center", "fit", "zoom"].find((x) => t.includes(x)) || "zoom";
};
const SIDES = ["left", "right", "top", "bottom"];
function parseSide(v, fallback) {
  const t = String(v ?? "").trim().toLowerCase();
  if (t.includes("all")) return "all";
  return SIDES.find((x) => t.includes(x)) || fallback;
}

// Where circle i starts (flying in) or ends (flying out): far enough off-screen even at the largest pulse size.
// "all" sends the circles to / from all four sides in turn.
function offscreenStart(side, i, x, y, R, W, H) {
  const sd = side === "all" ? SIDES[i % 4] : side;
  const m = R * 1.4 + 20;
  if (sd === "left" || sd === "right") {
    return { vert: false, x0: sd === "right" ? W + m : -m, y0: Math.min(H * 1.1, Math.max(-H * 0.1, y + (rand(i, 1) - 0.5) * H * 0.5)) };
  }
  return { vert: true, y0: sd === "bottom" ? H + m : -m, x0: Math.min(W * 1.1, Math.max(-W * 0.1, x + (rand(i, 1) - 0.5) * W * 0.5)) };
}

// Returns the circles for a fly-in from `side` and for a fly-out to `exitSide` (same targets, timings and pulses).
function buildCircles(n, R, side, exitSide, W, H, fly, grow, overlap) {
  const centers = layoutCenters(n, W, H);
  const make = (sd) => centers.map(([x, y], i) => ({
    x, y,
    ...offscreenStart(sd, i, x, y, R, W, H),
    arc: (rand(i, 2) - 0.5) * (H * 0.2),      // sideways bow of the flight path
    delay: rand(i, 3) * fly * 0.35,
    dur: fly * 0.65,
    phase: rand(i, 4) * Math.PI * 2,
    wobbles: 2 + rand(i, 5) * 2,              // size pulses during the flight
  }));
  const inSet = make(side), outSet = make(exitSide);
  // Each circle starts to grow shortly BEFORE it stops moving (overlap seconds before its own arrival),
  // so the swelling flows out of the movement instead of waiting for it to end.
  for (const set of [inSet, outSet]) for (const c of set) c.growStart = Math.max(0, c.delay + c.dur - overlap);
  const total = Math.max(...inSet.map((c) => c.growStart + grow));
  return { inSet, outSet, cover: Math.max(R, coverRadius(centers, W, H)), total };
}

// State of one circle at timeline position s (seconds).
function circleAt(c, s, R, cover, grow) {
  const k = clamp01((s - c.delay) / c.dur);
  // accelerate out of the screen edge, slow down on arrival and overshoot the target slightly (main axis only)
  const main = easeOutBack(easeInOutQuad(k)), side = easeInOutQuad(k), bow = c.arc * Math.sin(Math.PI * k);
  const x = c.vert ? c.x0 + (c.x - c.x0) * side + bow : c.x0 + (c.x - c.x0) * main;
  const y = c.vert ? c.y0 + (c.y - c.y0) * main : c.y0 + (c.y - c.y0) * side + bow;
  const flightR = R * (1 + 0.3 * (1 - k) * Math.sin(2 * Math.PI * c.wobbles * k + c.phase));
  const g = easeInOutCubic(clamp01((s - c.growStart) / grow));
  return { x, y, r: flightR + (cover - flightR) * g }; // growth starts from whatever size the pulsing has right now
}

// ------------------------------------------------------------------------------------------------ component
const SVGNS = "http://www.w3.org/2000/svg";
const TEMPLATE = `
<style>
  :host { position: absolute; inset: 0; display: block; overflow: hidden; pointer-events: none; }
  svg.stage { position: absolute; inset: 0; width: 100%; height: 100%; display: none; }
  :host(.on) svg.stage { display: block; }
</style>
<svg class="stage" xmlns="${SVGNS}" preserveAspectRatio="none">
  <defs>
    <clipPath id="reveal" clipPathUnits="userSpaceOnUse"></clipPath>
    <linearGradient id="ph" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2b2d42"/><stop offset="1" stop-color="#8d99ae"/>
    </linearGradient>
  </defs>
  <g class="content" clip-path="url(#reveal)">
    <rect class="bg" width="100%" height="100%" fill="#000"/>
    <rect class="placeholder" width="100%" height="100%" fill="url(#ph)"/>
    <image class="img" x="0" y="0" width="100%" height="100%" preserveAspectRatio="xMidYMid slice"/>
  </g>
</svg>
`;

export default class CircleImageReveal extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = TEMPLATE;
    this.stage = this.shadowRoot.querySelector("svg.stage");
    this.clip = this.shadowRoot.querySelector("#reveal");
    this.content = this.shadowRoot.querySelector(".content");
    this.bg = this.shadowRoot.querySelector(".bg");
    this.imgEl = this.shadowRoot.querySelector(".img");
    this.placeholder = this.shadowRoot.querySelector(".placeholder");
    this.data = { image: "", imageFit: "zoom", backgroundColor: "#00000000", circleCount: 12, startRadius: 90, side: "right", exitSide: "right",
      flySeconds: 1.6, growSeconds: 1.2, overlapSeconds: 0.4 };
    this.s = 0;          // position on the timeline in seconds: 0 = nothing visible, total = full image
    this.motion = 0;     // +1 playing in, -1 playing out, 0 idle (not "dir": that is a reserved HTML attribute)
    this.step = undefined;
    this.raf = null;
    this.lastNow = null;
    this.p = null;
    this.active = null;
    this.circleEls = [];
    this.imageUrl = null;
    this.natW = 0; this.natH = 0;
    this.waiters = [];
    this.timer = null;
  }

  // Everything that depends on the fields and the screen size; recalculated whenever a play starts from nothing.
  _setup() {
    const rect = this.getBoundingClientRect();
    const W = rect.width || 1920, H = rect.height || 1080;
    const n = Math.round(num(this.data.circleCount, 12, 1, 60));
    const R = num(this.data.startRadius, 90, 10, 600) * (W / REF_WIDTH);
    const fly = num(this.data.flySeconds, 1.6, 0.4, 10);
    const grow = num(this.data.growSeconds, 1.2, 0.3, 10);
    const overlap = num(this.data.overlapSeconds, 0.4, 0, 1.5);
    const side = parseSide(this.data.side, "right");
    const exitSide = parseSide(this.data.exitSide, side === "all" ? "all" : side);
    const { inSet, outSet, cover, total } = buildCircles(n, R, side, exitSide, W, H, fly, grow, overlap);
    const circles = inSet;
    this.p = { W, H, R, grow, circles, inSet, outSet, cover, total };
    this.active = inSet;
    this.stage.setAttribute("viewBox", `0 0 ${W} ${H}`);
    this.clip.replaceChildren();
    this.circleEls = circles.map(() => {
      const c = document.createElementNS(SVGNS, "circle");
      this.clip.append(c);
      return c;
    });
    this._applyImageLayout();
  }

  // How the image is placed on the screen (fit mode) and the colour behind it (visible when the image doesn't cover everything).
  _applyImageLayout() {
    const rect = this.getBoundingClientRect();
    const W = this.p?.W ?? (rect.width || 1920), H = this.p?.H ?? (rect.height || 1080);
    const fit = parseFit(this.data.imageFit);
    const img = this.imgEl;
    let x = 0, y = 0, w = W, h = H, par = "xMidYMid slice";
    if (fit === "fit") par = "xMidYMid meet";
    else if (fit === "stretch") par = "none";
    else if (fit === "center" && this.natW > 0 && this.natH > 0) { // original size, no scaling
      w = this.natW; h = this.natH; x = (W - w) / 2; y = (H - h) / 2; par = "none";
    } else if (fit === "center") par = "xMidYMid meet"; // size unknown (e.g. an SVG without dimensions)
    img.setAttribute("x", String(x)); img.setAttribute("y", String(y));
    img.setAttribute("width", String(w)); img.setAttribute("height", String(h));
    img.setAttribute("preserveAspectRatio", par);
    this.bg.setAttribute("fill", color(this.data.backgroundColor, "#00000000"));
  }

  _render() {
    if (!this.p) return;
    const { R, cover, grow } = this.p;
    const circles = this.active;
    const on = this.s > 0;
    this.classList.toggle("on", on);
    if (!on) return;
    // Even when fully revealed the image stays inside the (now screen-covering) circles: one single render path, no mode switch at the end.
    this.content.setAttribute("clip-path", "url(#reveal)");
    circles.forEach((c, i) => {
      const st = circleAt(c, this.s, R, cover, grow), el = this.circleEls[i];
      el.setAttribute("cx", st.x.toFixed(2));
      el.setAttribute("cy", st.y.toFixed(2));
      el.setAttribute("r", Math.max(0, st.r).toFixed(2));
    });
  }

  _loop = (now) => {
    // The first frame only establishes the time base (the frame timestamp can be slightly older than our own start time).
    const dt = this.lastNow === null ? 0 : Math.min(0.25, Math.max(0, (now - this.lastNow) / 1000));
    this.lastNow = now;
    this.s += this.motion * dt;
    // Only the end in the direction of travel counts, otherwise a 0 ms first frame would look like "arrived at the start".
    if (this.motion > 0 && this.s >= this.p.total) { this.s = this.p.total; this.motion = 0; }
    else if (this.motion < 0 && this.s <= 0) { this.s = 0; this.motion = 0; }
    this._render();
    if (this.motion !== 0) this.raf = requestAnimationFrame(this._loop);
    else this._settle();
  };

  // Resolves everybody waiting for the animation to finish (or to be superseded by a newer one).
  _settle() {
    clearTimeout(this.timer);
    const w = this.waiters;
    this.waiters = [];
    for (const resolve of w) resolve();
  }

  _go(direction, skip) {
    if (direction > 0 && this.s <= 0) this._setup(); // fresh start: pick up the current field values and screen size
    if (!this.p) this._setup();
    cancelAnimationFrame(this.raf);
    this._settle(); // an earlier play/stop that is still running is superseded
    // The set of paths only changes when the animation is idle; reversing in mid-flight keeps the current paths (no jump).
    if (this.motion === 0) this.active = direction < 0 ? this.p.outSet : this.p.inSet;
    if (skip) {
      this.s = direction > 0 ? this.p.total : 0;
      this.motion = 0;
      this._render();
      return Promise.resolve();
    }
    this.motion = direction;
    this.lastNow = null;
    this._render();
    const remaining = direction > 0 ? this.p.total - this.s : this.s;
    return new Promise((resolve) => {
      this.waiters.push(resolve);
      // safety net: a hidden tab doesn't run animation frames, never leave the caller waiting forever
      this.timer = setTimeout(() => this._settle(), (remaining + 1.5) * 1000);
      this.raf = requestAnimationFrame(this._loop);
    });
  }

  _applyImage() {
    const url = String(this.data.image ?? "").trim();
    if (url === this.imageUrl) return Promise.resolve();
    this.imageUrl = url;
    if (!url) {
      this.natW = this.natH = 0;
      this.imgEl.removeAttribute("href");
      this.placeholder.style.display = "";
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const probe = new Image();
      const done = (ok) => {
        if (this.imageUrl !== url) return resolve();      // a newer image was requested meanwhile
        this.placeholder.style.display = ok ? "none" : ""; // show the placeholder if the image can't be loaded
        if (ok) this.imgEl.setAttribute("href", url); else this.imgEl.removeAttribute("href");
        this._applyImageLayout();
        resolve();
      };
      probe.onload = () => { this.natW = probe.naturalWidth; this.natH = probe.naturalHeight; done(true); };
      probe.onerror = () => done(false);
      probe.src = url;
      setTimeout(() => done(probe.complete && probe.naturalWidth > 0), 8000); // don't block load() forever
    });
  }

  _merge(data) {
    if (data && typeof data === "object") for (const k of KEYS) if (k in data) this.data[k] = data[k];
  }

  async load(params) {
    this._merge(params?.data);
    await this._applyImage(); // wait for the image so it doesn't pop in during the animation
    return { statusCode: 200 };
  }

  async dispose() {
    cancelAnimationFrame(this.raf);
    this._settle();
    this.shadowRoot.innerHTML = "";
    return { statusCode: 200 };
  }

  // Image, fit mode and background colour change immediately; circle count, radius, sides and timings apply the next time it is played.
  async updateAction(params) {
    this._merge(params?.data);
    await this._applyImage();
    this._applyImageLayout();
    return { statusCode: 200 };
  }

  // Step model (stepCount 1): play -> step 0 (image fully visible). Playing again moves past the last step,
  // which is the end of the graphic, so the image animates out. The target step follows the OGraf spec.
  async playAction(params) {
    const goto = Number.isInteger(params?.goto) && params.goto >= 0 ? params.goto : undefined;
    const delta = Number.isFinite(params?.delta) ? params.delta : 1;
    const target = goto !== undefined ? goto : (this.step === undefined ? -1 : this.step) + delta;
    if (target >= STEP_COUNT || target < 0) {
      this.step = undefined;
    } else {
      this.step = target;
    }
    const step = this.step; // a newer call may change this.step while we wait
    await this._go(step === undefined ? -1 : +1, params?.skipAnimation);
    return { statusCode: 200, currentStep: step };
  }

  async stopAction(params) {
    this.step = undefined;
    await this._go(-1, params?.skipAnimation); // resolves once the image is gone: the renderer may remove the graphic right after
    return { statusCode: 200 };
  }

  async customAction(params) {
    return { statusCode: 404, statusMessage: `Unknown action: ${params?.id}` };
  }
}
