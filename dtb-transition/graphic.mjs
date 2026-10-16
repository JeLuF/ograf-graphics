// DTB Scene Transition - OGraf web component
const KEYS = ["holdSeconds", "flySeconds", "heightPercent", "rotationDegrees", "startSizePercent"];

const num = (v, fallback, min, max) => {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const easeOutCubic = (k) => 1 - Math.pow(1 - k, 3);   // soft landing
const easeInCubic = (k) => k * k * k;                  // gentle start when leaving
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

// pos: 0 = F's far away at the screen corners, 1 = Turnerkreuz assembled.  bg: white background opacity.
// turn: rotation in units of the configured angle (0 = upright). The F's arrive turning one way (-1 -> 0)
// and leave turning on in the same direction (0 -> +1), so the motion never reverses.
// The normal sequence: fly in (and fade to white) -> hold opaque -> fly out (and fade to transparent).
function sequenceFrame(t, fly, hold) {
  if (t < fly) { const k = t / fly, pos = easeOutCubic(k); return { phase: "in", pos, bg: easeInOut(k), turn: -(1 - pos) }; }
  if (t < fly + hold) return { phase: "hold", pos: 1, bg: 1, turn: 0 };
  const k = (t - fly - hold) / fly;
  if (k >= 1) return { phase: "done", pos: 0, bg: 0, turn: 1 };
  const pos = 1 - easeInCubic(k);
  return { phase: "out", pos, bg: 1 - easeInOut(k), turn: 1 - pos };
}

// Fly out from wherever the animation currently is (used when the sequence is stopped early).
function outFrame(t, fly, pos0, bg0, turn0) {
  const k = t / fly;
  if (k >= 1) return { phase: "done", pos: 0, bg: 0, turn: 1 };
  const e = easeInCubic(k);
  return { phase: "out", pos: pos0 * (1 - e), bg: bg0 * (1 - easeInOut(k)), turn: turn0 + (1 - turn0) * e };
}

// Size of the F's: they start small, grow past full size shortly before arriving (about +12%)
// and settle back at exactly 100%. On the way out it runs in reverse: swell a little, then shrink away.
const BUMP = 0.25;
const sizeAt = (pos, start) => start + (1 - start) * pos + BUMP * Math.sin(Math.PI * Math.pow(pos, 3));

// The four F's of the Turnerkreuz (same construction as in the other DTB graphics), one group each.
const F_DEFS = `<defs><path id="f" d="M0 0H44V11H12V18H34V29H12V46H0Z"/></defs>`;
const F_TRANSFORMS = [
  "translate(46 46) scale(-1 -1)", // top left
  "translate(54 46) scale(1 -1)",  // top right
  "translate(46 54) scale(-1 1)",  // bottom left
  "translate(54 54)",              // bottom right
];
const CORNER_SIGNS = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
const F_CENTERS = [[24, 23], [76, 23], [24, 77], [76, 77]]; // centre of each F in the 100x100 viewBox

const TEMPLATE = `
<style>
  :host { position: absolute; inset: 0; display: block; overflow: hidden; pointer-events: none; }
  .bg { position: absolute; inset: 0; background: #fff; opacity: 0; }
  svg.cross { position: absolute; left: 50%; top: 50%; aspect-ratio: 1; height: 80%;
              transform: translate(-50%, -50%); overflow: visible; fill: #e30613; visibility: hidden; }
  :host(.running) svg.cross { visibility: visible; }
</style>
<div class="bg"></div>
<svg class="cross" viewBox="0 0 100 100">
  ${F_DEFS}
  ${F_TRANSFORMS.map((t) => `<g class="fl"><use href="#f" transform="${t}"/></g>`).join("")}
</svg>
`;

export default class DtbSceneTransition extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = TEMPLATE;
    this.bg = this.shadowRoot.querySelector(".bg");
    this.cross = this.shadowRoot.querySelector("svg.cross");
    this.groups = [...this.shadowRoot.querySelectorAll("g.fl")];
    this.data = { holdSeconds: "2", flySeconds: "1", heightPercent: "80", rotationDegrees: "90", startSizePercent: "40" };
    this.running = false;
    this.raf = null;
    this.abort = null;       // { t0, pos0, bg0 } once Stop was pressed during the sequence
    this.last = { pos: 0, bg: 0, turn: 0 };
    this.offsets = [[0, 0], [0, 0], [0, 0], [0, 0]];
  }

  _params() {
    return {
      hold: num(this.data.holdSeconds, 2, 0, 60),
      fly: num(this.data.flySeconds, 1, 0.2, 10),
      height: num(this.data.heightPercent, 80, 10, 100),
      rotation: num(this.data.rotationDegrees, 90, -720, 720),
      startSize: num(this.data.startSizePercent, 40, 5, 300) / 100,
    };
  }

  // Distance (in SVG units) each F has to travel so that it starts completely outside the screen corner.
  _measure(heightPercent, startSize) {
    const rect = this.getBoundingClientRect();
    const W = rect.width || 1920, H = rect.height || 1080;
    const u = (H * heightPercent) / 100 / 100;            // px per SVG unit
    const margin = Math.max(10, 32 * startSize - 18);      // far enough that a rotated, enlarged F is still off-screen
    const ox = W / 2 / u + margin, oy = H / 2 / u + margin;
    this.offsets = CORNER_SIGNS.map(([sx, sy]) => [sx * ox, sy * oy]);
  }

  _apply(frame) {
    this.last = { pos: frame.pos, bg: frame.bg, turn: frame.turn ?? 0 };
    const p = this.p ?? this._params();
    const away = 1 - frame.pos;
    const size = sizeAt(frame.pos, p.startSize);
    const rot = (frame.turn ?? 0) * p.rotation;
    this.groups.forEach((g, i) => {
      const [dx, dy] = this.offsets[i];
      const [cx, cy] = F_CENTERS[i];
      // fly (translate), then spin and scale each F around its own centre
      g.setAttribute("transform",
        `translate(${(dx * away).toFixed(3)} ${(dy * away).toFixed(3)}) translate(${cx} ${cy}) `
        + `rotate(${rot.toFixed(3)}) scale(${size.toFixed(4)}) translate(${-cx} ${-cy})`);
    });
    this.bg.style.opacity = String(frame.bg);
  }

  _start(now) {
    const p = this._params();
    this.cross.style.height = `${p.height}%`;
    this._measure(p.height, p.startSize);
    this.p = p;
    this.t0 = now;
    this.abort = null;
    this.running = true;
    this.classList.add("running");
    this._apply({ pos: 0, bg: 0, turn: -1 });
  }

  _tick(now) {
    if (!this.running) return false;
    const t = (now - (this.abort ? this.abort.t0 : this.t0)) / 1000;
    const frame = this.abort
      ? outFrame(t, this.p.fly, this.abort.pos0, this.abort.bg0, this.abort.turn0)
      : sequenceFrame(t, this.p.fly, this.p.hold);
    if (frame.phase === "done") { this._finish(); return false; }
    this._apply(frame);
    return true;
  }

  _loop = (now) => {
    if (this._tick(now)) this.raf = requestAnimationFrame(this._loop);
  };

  _finish() {
    cancelAnimationFrame(this.raf);
    this.running = false;
    this.abort = null;
    this._apply({ pos: 0, bg: 0, turn: 0 });
    this.classList.remove("running");
  }

  async load(params) {
    if (params?.data && typeof params.data === "object") for (const k of KEYS) if (k in params.data) this.data[k] = params.data[k];
    return { statusCode: 200 };
  }

  async dispose() {
    cancelAnimationFrame(this.raf);
    this.shadowRoot.innerHTML = "";
    return { statusCode: 200 };
  }

  async updateAction(params) {
    // new timings are used the next time the transition is played
    if (params?.data && typeof params.data === "object") for (const k of KEYS) if (k in params.data) this.data[k] = params.data[k];
    return { statusCode: 200 };
  }

  // stepCount is 0 (a graphic that is played once): playAction animates in, holds for the configured time and
  // animates out by itself. There is no step to remain on, so currentStep is always undefined.
  // Calling it again while the sequence is running does nothing.
  async playAction() {
    if (!this.running) {
      this._start(performance.now());
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(this._loop);
    }
    return { statusCode: 200, currentStep: undefined };
  }

  // Stop ends the transition early: the F's fly out from where they are, the background fades out.
  async stopAction(params) {
    if (!this.running) return { statusCode: 200 };
    if (params?.skipAnimation) { this._finish(); return { statusCode: 200 }; }
    if (!this.abort) {
      const frame = sequenceFrame((performance.now() - this.t0) / 1000, this.p.fly, this.p.hold);
      this.abort = { t0: performance.now(), pos0: frame.pos, bg0: frame.bg, turn0: frame.turn };
    }
    return { statusCode: 200 };
  }

  async customAction(params) {
    return { statusCode: 404, statusMessage: `Unknown action: ${params?.id}` };
  }
}
