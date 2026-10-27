// Logo Tile Transition - OGraf web component.
// Zero-step graphic (stepCount 0): playAction() runs the whole sequence once and the graphic animates out by itself.
//
// Sequence: a wave of rounded tiles (the logo's shape) pops in from the screen centre while the logo drops in with a
// somersault and bounces; it sways and holds while the screen is fully covered; then the logo leaps out with a backflip
// and the tiles shrink away from the centre outwards.
const KEYS = ["logo", "holdSeconds", "tileColumns", "heightPercent"];

const num = (v, fallback, min, max) => {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

// Logo box in SVG units; the logo image is fitted into this square (default assets/logo.svg: viewBox 85.04 x 85.04).
const LOGO_SIZE = 85.04;
const DEFAULT_LOGO = "./assets/logo.svg";
// Logo path from the "logo" field, resolved relative to this module (absolute URLs pass through).
function logoUrl(path) {
  try { return new URL(String(path || DEFAULT_LOGO), import.meta.url).href; }
  catch { return new URL(DEFAULT_LOGO, import.meta.url).href; }
}

const TILE_COLORS = ["#c8121f", "#b00f1b"]; // darker than the logo's red so the logo stands out
const TILE_RADIUS = 0.06;                   // corner radius relative to tile size (same proportion as the logo)
const TILE_OVERLAP = 1.06;                  // tiles overlap slightly so no gaps show between rounded corners

// ---------------------------------------------------------------------------------------------------- easing
const clamp01 = (k) => Math.min(1, Math.max(0, k));
const easeOutCubic = (k) => 1 - Math.pow(1 - k, 3);
const easeInCubic = (k) => k * k * k;
const easeInOutCubic = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const easeOutBack = (k) => { const c1 = 2.2, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };
const easeInBack = (k) => { const c1 = 1.9, c3 = c1 + 1; return c3 * k * k * k - c1 * k * k; };
const easeOutBounce = (k) => {
  const n1 = 7.5625, d1 = 2.75;
  if (k < 1 / d1) return n1 * k * k;
  if (k < 2 / d1) { k -= 1.5 / d1; return n1 * k * k + 0.75; }
  if (k < 2.5 / d1) { k -= 2.25 / d1; return n1 * k * k + 0.9375; }
  k -= 2.625 / d1; return n1 * k * k + 0.984375;
};
// deterministic pseudo random number in 0..1 (the same tiles wobble the same way on every run)
const rand = (i, salt) => { const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453; return x - Math.floor(x); };

// ---------------------------------------------------------------------------------------------------- timeline (seconds)
const T = {
  tileDelayMax: 0.5, tileJitter: 0.08, tileDur: 0.45,        // tiles pop in, centre first
  dropStart: 0.5, dropDur: 0.9,                              // logo drops in and bounces
  outLogo: 0.6,                                              // logo squashes, then leaps away
  outTileStart: 0.3, outDelayMax: 0.45, outJitter: 0.06, outTileDur: 0.45, // tiles shrink away, centre first
};
const IN_END = T.dropStart + T.dropDur; // the logo has landed; the hold starts here
const totalDuration = (hold) => IN_END + hold + T.outTileStart + T.outDelayMax + T.outJitter + T.outTileDur;

// ---------------------------------------------------------------------------------------------------- tiles
function buildTiles(W, H, cols) {
  const cell = W / cols;
  const rows = Math.max(1, Math.ceil(H / cell - 1e-6));
  const oy = (H - rows * cell) / 2;
  const maxD = Math.hypot(W / 2, H / 2);
  const tiles = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const cx = (c + 0.5) * cell, cy = oy + (r + 0.5) * cell;
      tiles.push({
        cx, cy,
        d: Math.min(1, Math.hypot(cx - W / 2, cy - H / 2) / maxD), // 0 = centre, 1 = corner
        shade: (r + c) % 2,
        jIn: rand(i, 1) * T.tileJitter, jOut: rand(i, 2) * T.outJitter,
        rot0: (rand(i, 3) < 0.5 ? -1 : 1) * (35 + rand(i, 4) * 55),
      });
    }
  }
  return { tiles, size: cell * TILE_OVERLAP };
}

function tileFrame(tl, t, hold) {
  const outBegin = IN_END + hold + T.outTileStart;
  if (t < outBegin) {
    const k = (t - (tl.d * T.tileDelayMax + tl.jIn)) / T.tileDur;
    if (k <= 0) return { scale: 0, rot: tl.rot0 };
    const kk = clamp01(k);
    return { scale: easeOutBack(kk), rot: tl.rot0 * (1 - easeOutCubic(kk)) };
  }
  const k = clamp01((t - (outBegin + tl.d * T.outDelayMax + tl.jOut)) / T.outTileDur);
  return { scale: Math.max(0, 1 - easeInBack(k)), rot: -tl.rot0 * 0.6 * easeInCubic(k) };
}

// ---------------------------------------------------------------------------------------------------- logo
// Landing contacts of easeOutBounce (as fractions of the drop) and how hard the logo squashes on each.
const CONTACTS = [[1 / 2.75, 0.26], [2 / 2.75, 0.14], [2.5 / 2.75, 0.07], [1, 0.035]];
const HIDDEN = { visible: false, yFrac: 1, rot: 0, sx: 1, sy: 1 };

// yFrac: 0 = landed in the centre of the screen, 1 = completely above the screen.
function logoFrame(t, hold) {
  if (t < T.dropStart) return HIDDEN;
  const outStart = IN_END + hold;
  const k = (t - T.dropStart) / T.dropDur; // not clamped: squash tails continue into the hold
  let yFrac = 1 - easeOutBounce(clamp01(k));
  let rot = -360 * (1 - easeOutCubic(clamp01(k / CONTACTS[0][0]))); // somersault during the first fall
  let squash = 0;
  for (const [c, a] of CONTACTS) { const dk = k - c, w = dk < 0 ? 0.035 : 0.1; squash += a * Math.exp(-(dk / w) * (dk / w)); }
  squash = Math.min(squash, 0.38);
  const stretch = k < CONTACTS[0][0] ? 0.1 * easeInCubic(k / CONTACTS[0][0]) : 0;
  let sy = 1 - squash + stretch, sx = 1 + squash * 0.8 - stretch * 0.5;

  // playful sway and breathing while the screen is covered; fades out as the logo gets ready to leave
  const th = Math.max(0, t - IN_END);
  const amp = easeInOutCubic(clamp01(th / 0.4)) * (t >= outStart ? 1 - easeInOutCubic(clamp01((t - outStart) / 0.25)) : 1);
  rot += amp * 2.6 * Math.sin(2 * Math.PI * 0.85 * th);
  const breathe = 1 + amp * 0.012 * Math.sin(2 * Math.PI * 1.7 * th);
  sx *= breathe; sy *= breathe;

  if (t >= outStart) {
    const ko = (t - outStart) / T.outLogo;
    if (ko >= 1) return HIDDEN;
    const A = 0.28; // share of the exit spent crouching before the jump
    if (ko < A) {
      const s = easeInOutCubic(ko / A);
      sy *= 1 - 0.22 * s; sx *= 1 + 0.2 * s;
    } else {
      const kk = (ko - A) / (1 - A);
      const e = easeOutCubic(Math.min(1, kk * 3));
      sy = 0.78 + 0.42 * e; sx = 1.2 - 0.3 * e;       // squashed -> stretched while leaping
      yFrac = 1.08 * easeInCubic(kk);
      rot += 360 * easeInCubic(kk);                    // backflip
    }
  }
  return { visible: true, yFrac, rot, sx, sy };
}

// ---------------------------------------------------------------------------------------------------- component
const SVGNS = "http://www.w3.org/2000/svg";
const TEMPLATE = `
<style>
  :host { position: absolute; inset: 0; display: block; overflow: hidden; pointer-events: none; }
  svg.stage { position: absolute; inset: 0; width: 100%; height: 100%; display: none; }
  :host(.running) svg.stage { display: block; }
</style>
<svg class="stage" xmlns="${SVGNS}" preserveAspectRatio="none">
  <defs>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="170%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="14"/>
      <feOffset dy="10"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.4"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <g class="tiles"></g>
  <g class="logo-wrap" filter="url(#shadow)"><g class="logo"><image width="${LOGO_SIZE}" height="${LOGO_SIZE}" preserveAspectRatio="xMidYMid meet"/></g></g>
</svg>
`;

export default class LogoTileTransition extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = TEMPLATE;
    this.stage = this.shadowRoot.querySelector("svg.stage");
    this.tilesG = this.shadowRoot.querySelector(".tiles");
    this.logoWrap = this.shadowRoot.querySelector(".logo-wrap");
    this.logoG = this.shadowRoot.querySelector(".logo");
    this.logoImg = this.logoG.querySelector("image");
    this.preload = new Image();
    this.data = { holdSeconds: "1.5", tileColumns: "8", heightPercent: "70" };
    this.running = false;
    this.aborted = false;
    this.raf = null;
    this.t0 = 0;
    this.p = null;
    this.rects = [];
    this._applyLogo();
  }

  _applyLogo() {
    const url = logoUrl(this.data.logo);
    if (this.logoImg.getAttribute("href") === url) return;
    this.logoImg.setAttribute("href", url);
    this.preload.src = url;
  }

  _setup() {
    const rect = this.getBoundingClientRect();
    const W = rect.width || 1920, H = rect.height || 1080;
    const cols = Math.round(num(this.data.tileColumns, 8, 3, 20));
    const { tiles, size } = buildTiles(W, H, cols);
    this.stage.setAttribute("viewBox", `0 0 ${W} ${H}`);
    this.tilesG.replaceChildren();
    this.rects = tiles.map((tl) => {
      const r = document.createElementNS(SVGNS, "rect");
      r.setAttribute("x", String(-size / 2)); r.setAttribute("y", String(-size / 2));
      r.setAttribute("width", String(size)); r.setAttribute("height", String(size));
      r.setAttribute("rx", String(size * TILE_RADIUS));
      r.setAttribute("fill", TILE_COLORS[tl.shade]);
      this.tilesG.append(r);
      return r;
    });
    this.p = {
      W, H, tiles,
      hold: num(this.data.holdSeconds, 1.5, 0, 60),
      logoSize: (H * num(this.data.heightPercent, 70, 20, 100)) / 100,
    };
  }

  _render(t) {
    const { W, H, tiles, hold, logoSize } = this.p;
    tiles.forEach((tl, i) => {
      const f = tileFrame(tl, t, hold), r = this.rects[i];
      if (f.scale <= 0.001) { r.style.display = "none"; return; }
      r.style.display = "";
      r.setAttribute("transform", `translate(${tl.cx.toFixed(2)} ${tl.cy.toFixed(2)}) rotate(${f.rot.toFixed(2)}) scale(${f.scale.toFixed(4)})`);
    });
    const lf = logoFrame(t, hold);
    this.logoWrap.style.display = lf.visible ? "" : "none";
    if (!lf.visible) return;
    const k = logoSize / LOGO_SIZE;
    const travel = H / 2 + logoSize * 0.75 + 120; // enough to leave the screen even while rotated
    const y = -lf.yFrac * travel;
    // squash and stretch keep the bottom edge in place; rotation (the flips) is about the centre
    this.logoG.setAttribute("transform",
      `translate(${(W / 2).toFixed(2)} ${(H / 2 + y).toFixed(2)}) rotate(${lf.rot.toFixed(2)}) `
      + `translate(0 ${((logoSize / 2) * (1 - lf.sy)).toFixed(2)}) scale(${(lf.sx * k).toFixed(5)} ${(lf.sy * k).toFixed(5)}) `
      + `translate(${-LOGO_SIZE / 2} ${-LOGO_SIZE / 2})`);
  }

  _start(now) {
    this._setup();
    this.t0 = now;
    this.aborted = false;
    this.running = true;
    this.classList.add("running");
    this._render(0);
  }

  _tick(now) {
    if (!this.running) return false;
    const t = (now - this.t0) / 1000;
    if (t >= totalDuration(this.p.hold)) { this._finish(); return false; }
    this._render(t);
    return true;
  }

  _loop = (now) => { if (this._tick(now)) this.raf = requestAnimationFrame(this._loop); };

  _finish() {
    cancelAnimationFrame(this.raf);
    this.running = false;
    this.aborted = false;
    this.classList.remove("running");
    this.logoWrap.style.display = "none";
  }

  _merge(data) {
    if (data && typeof data === "object") for (const k of KEYS) if (k in data) this.data[k] = data[k];
    this._applyLogo();
  }

  async load(params) {
    this._merge(params?.data);
    return { statusCode: 200 };
  }

  async dispose() {
    cancelAnimationFrame(this.raf);
    this.shadowRoot.innerHTML = "";
    return { statusCode: 200 };
  }

  async updateAction(params) {
    this._merge(params?.data); // applies the next time the transition is played
    return { statusCode: 200 };
  }

  // stepCount is 0: playAction animates in, holds for the configured time and animates out by itself,
  // so there is no step to stay on and currentStep is always undefined. Playing while running does nothing.
  async playAction() {
    if (!this.running) {
      await this.preload.decode?.().catch(() => {}); // have the logo ready before the first frame
      this._start(performance.now());
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(this._loop);
    }
    return { statusCode: 200, currentStep: undefined };
  }

  // Optional early exit: ends the hold right now (the logo leaps out from where it is, without a visual jump).
  async stopAction(params) {
    if (!this.running) return { statusCode: 200 };
    if (params?.skipAnimation) { this._finish(); return { statusCode: 200 }; }
    if (!this.aborted) {
      this.aborted = true;
      const t = (performance.now() - this.t0) / 1000;
      this.p.hold = Math.max(0, Math.min(this.p.hold, t - IN_END));
    }
    return { statusCode: 200 };
  }

  async customAction(params) {
    return { statusCode: 404, statusMessage: `Unknown action: ${params?.id}` };
  }
}
