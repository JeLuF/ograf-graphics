// Lottie Player - OGraf web component
// Plays a Lottie (Bodymovin) JSON file. If the file has markers named "in", "loop" and "out", Play runs "in" and
// then repeats "loop" (or holds the last "in" frame), Stop runs "out". Without markers the whole animation is
// played (looped or once) and Stop fades it out.
// The one-shot variant (graphic-once.mjs, stepCount 0) plays everything once (with markers: in, loop, out),
// clears the screen by itself and then resolves playAction with currentStep undefined (= end of the graphic).
import lottie from "./lib/lottie_svg.min.js";

const KEYS = ["lottieFile", "loop", "speed", "size", "x", "y"];
const DEFAULT_FILE = "./assets/sample.json";
const FADE_MS = 400; // Stop without an "out" marker

// Asset path from a field, resolved relative to this module (absolute URLs pass through).
function assetUrl(path, fallback) {
  try { return new URL(String(path || fallback), import.meta.url).href; }
  catch { return new URL(fallback, import.meta.url).href; }
}

const num = (v, fallback, min, max) => {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

// Marker segments in absolute frames: { in: [from, to], loop: [...], out: [...] } (only the ones present).
function readMarkers(data) {
  const seg = {};
  for (const m of data.markers ?? []) {
    let name = m.cm;
    try { const p = JSON.parse(name); if (p && typeof p === "object") name = p.name ?? name; } catch {}
    name = String(name ?? "").trim().toLowerCase();
    if (["in", "loop", "out"].includes(name) && !(name in seg)) seg[name] = [m.tm, m.tm + Math.max(m.dr ?? 0, 0)];
  }
  return seg;
}

const TEMPLATE = `
<style>
  :host { position: absolute; inset: 0; display: block; overflow: hidden; pointer-events: none; }
  .stage { position: absolute; opacity: 0; }
  .stage.visible { opacity: 1; }
  .stage.fading { transition: opacity ${FADE_MS}ms ease; }
  .stage svg { display: block; }
</style>
<div class="stage"></div>
`;

export default class LottiePlayer extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = TEMPLATE;
    this.stage = this.shadowRoot.querySelector(".stage");
    this.data = { lottieFile: DEFAULT_FILE, loop: "loop", speed: "1", size: "100", x: "50", y: "50" };
    this.anim = null;
    this.url = null;
    this.phase = "idle"; // idle | in | loop | hold | out | fade | once
    this.done = null;    // resolves the pending playAction of a "once-clear" run
    this.currentStep = undefined; // OGraf step: 0 while on air, undefined at start/end
    this.raf = null;
    this.timer = null;
  }

  // ---- loading ----

  async _loadFile() {
    const url = assetUrl(this.data.lottieFile, DEFAULT_FILE);
    if (url === this.url && this.anim) return;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Cannot load ${url}: HTTP ${res.status}`);
    const json = await res.json();
    if (!json || !Array.isArray(json.layers)) throw new Error(`${url} is not a Lottie animation`);

    this._destroyAnim();
    this.url = url;
    this.ip = json.ip ?? 0;
    this.op = json.op ?? 0;
    this.fps = json.fr || 25;
    this.markers = readMarkers(json);
    // external images: make their folder absolute so they resolve next to the JSON file
    for (const a of json.assets ?? []) if (a.p && !a.e && !a.layers) a.u = new URL(a.u ?? "", url).href;
    this.anim = lottie.loadAnimation({
      container: this.stage,
      renderer: "svg",
      loop: false,
      autoplay: false,
      animationData: json,
      rendererSettings: { preserveAspectRatio: `xMidYMid meet`, progressiveLoad: false },
    });
    await new Promise((resolve) => {
      const done = () => { clearTimeout(t); resolve(); };
      const t = setTimeout(resolve, 3000);
      this.anim.addEventListener("DOMLoaded", done);
      this.anim.addEventListener("data_failed", done);
    });
    this._show(this.phase === "idle" ? this._firstFrame() : this._restFrame());
  }

  _destroyAnim() {
    cancelAnimationFrame(this.raf);
    this.anim?.destroy();
    this.anim = null;
    this.url = null;
  }

  // ---- layout ----

  _applyLayout() {
    const size = num(this.data.size, 100, 1, 400);
    const s = this.stage.style;
    s.width = `${size}%`;
    s.height = `${size}%`;
    // x/y = centre of the box in % of the screen (50/50 = centred); the SVG is fitted into the box
    s.left = `${num(this.data.x, 50, -500, 600) - size / 2}%`;
    s.top = `${num(this.data.y, 50, -500, 600) - size / 2}%`;
    this.stage.querySelector("svg")?.setAttribute("preserveAspectRatio", `xMidYMid meet`);
  }

  // ---- frame driving (absolute frames; lottie's goToAndStop counts from ip) ----

  _firstFrame() { return (this.markers.in ?? [this.ip])[0]; }

  // The frame shown when the graphic is on air without animating (skipAnimation, or after "in" without "loop")
  _restFrame() {
    if (this.markers.loop) return this.markers.loop[0];
    if (this.markers.in) return this.markers.in[1];
    return this._looping() ? this.ip : this.op;
  }

  // "loop" | "once" (hold last frame); the one-shot subclass returns "once-clear" (play once, then clear)
  _mode() {
    const m = String(this.data.loop ?? "").trim().toLowerCase();
    return ["loop", "once"].includes(m) ? m : "loop";
  }

  // OGraf target step for stepCount 1: 0, or undefined = transition to the end
  _targetStep(params) {
    const goto = params?.goto;
    const delta = Number.isInteger(params?.delta) ? params.delta : 1;
    const target = Number.isInteger(goto) && goto >= 0 ? goto : (this.currentStep ?? -1) + delta;
    return target >= 1 ? undefined : 0;
  }

  _looping() { return this._mode() === "loop"; }

  _show(frame) {
    if (!this.anim) return;
    const f = Math.min(Math.max(frame, this.ip), this.op - 0.001);
    this.anim.goToAndStop(f - this.ip, true);
  }

  // Runs [from, to] once (or repeatedly) and calls onEnd at the end of a single run.
  _run(phase, [from, to], repeat, onEnd) {
    cancelAnimationFrame(this.raf);
    this.phase = phase;
    const len = Math.max(to - from, 0);
    const t0 = performance.now();
    const step = (now) => {
      if (this.phase !== phase) return;
      const frames = ((now - t0) / 1000) * this.fps * num(this.data.speed, 1, 0.05, 10);
      if (repeat && len > 0) {
        this._show(from + (frames % len));
      } else if (frames >= len) {
        this._show(to);
        onEnd?.();
        return;
      } else {
        this._show(from + frames);
      }
      this.raf = requestAnimationFrame(step);
    };
    this._show(from);
    this.raf = requestAnimationFrame(step);
  }

  _playIn(skip) {
    clearTimeout(this.timer);
    this.stage.classList.remove("fading");
    this.stage.classList.add("visible");
    const m = this.markers;
    const hasMarkers = !!(m.in || m.loop || m.out);
    const whole = [this.ip, this.op];
    // what follows the intro: repeat "loop" (or the whole file), otherwise hold the rest frame
    const rest = () => {
      if (m.loop) this._run("loop", m.loop, true);
      else if (!hasMarkers && this._looping()) this._run("loop", whole, true);
      else { cancelAnimationFrame(this.raf); this.phase = "hold"; this._show(this._restFrame()); }
    };
    if (skip) rest();
    else if (m.in) this._run("in", m.in, false, rest);
    else if (!hasMarkers && !this._looping()) this._run("in", whole, false, rest);
    else rest();
  }

  // Plays all parts once (in, loop, out - or the whole file), then clears. Resolves when the screen is clear.
  _playOnceAndClear(skip) {
    clearTimeout(this.timer);
    this._settle();
    const m = this.markers;
    const parts = m.in || m.loop || m.out ? [m.in, m.loop, m.out].filter(Boolean) : [[this.ip, this.op]];
    const finished = new Promise((resolve) => { this.done = resolve; });
    if (skip) { this._clear(); return finished; }
    this.stage.classList.remove("fading");
    this.stage.classList.add("visible");
    let i = 0;
    const next = () => (i < parts.length ? this._run("once", parts[i++], false, next) : this._clear());
    next();
    return finished;
  }

  // Off air: hide, rewind, and release a pending once-clear playAction
  _clear() {
    this.currentStep = undefined;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.timer);
    this.phase = "idle";
    this.stage.classList.remove("visible", "fading");
    this._show(this._firstFrame());
    this._settle();
  }

  _settle() {
    const done = this.done;
    this.done = null;
    done?.();
  }

  _playOut(skip) {
    clearTimeout(this.timer);
    const finish = () => this._clear();
    if (skip || this.phase === "idle") { finish(); return; }
    // the out part runs only from the on-air state, not in the middle of a once-clear run
    if (this.markers.out && this.phase !== "once") { this._run("out", this.markers.out, false, finish); return; }
    this.phase = "fade";
    this.stage.classList.add("fading");
    this.stage.classList.remove("visible");
    this.timer = setTimeout(finish, FADE_MS);
  }

  _merge(data) {
    if (data && typeof data === "object") for (const k of KEYS) if (k in data) this.data[k] = data[k];
    this._applyLayout();
  }

  // ---- OGraf API ----

  async load(params) {
    this._merge(params?.data);
    try {
      await this._loadFile();
    } catch (e) {
      return { statusCode: 500, statusMessage: String(e?.message ?? e) };
    }
    this._applyLayout();
    return { statusCode: 200 };
  }

  async dispose() {
    clearTimeout(this.timer);
    this._settle();
    this._destroyAnim();
    this.shadowRoot.innerHTML = "";
    return { statusCode: 200 };
  }

  async updateAction(params) {
    const onAir = this.phase !== "idle" && this.phase !== "fade";
    this._merge(params?.data);
    try {
      const before = this.url;
      await this._loadFile();
      if (this.url !== before && onAir) {
        if (this.phase === "once") this._clear(); // a once-clear run of the old file ends
        else this._playIn(true);                   // new file while on air: show its loop/rest state
      }
    } catch (e) {
      return { statusCode: 500, statusMessage: String(e?.message ?? e) };
    }
    this._applyLayout();
    return { statusCode: 200 };
  }

  async playAction(params) {
    if (!this.anim) return { statusCode: 500, statusMessage: "No animation loaded" };
    if (this._mode() === "once-clear") {
      await this._playOnceAndClear(params?.skipAnimation); // resolves when finished, stopped or disposed
      return { statusCode: 200, currentStep: undefined };
    }
    if (this._targetStep(params) === undefined) { // step beyond the last one: go to the end
      this._playOut(params?.skipAnimation);
      this.currentStep = undefined;
      return { statusCode: 200, currentStep: undefined };
    }
    this._playIn(params?.skipAnimation);
    this.currentStep = 0;
    return { statusCode: 200, currentStep: 0 };
  }

  async stopAction(params) {
    this.currentStep = undefined;
    this._playOut(params?.skipAnimation);
    return { statusCode: 200 };
  }

  async customAction(params) {
    if (params?.id === "restart") {
      if (!this.anim) return { statusCode: 500, statusMessage: "No animation loaded" };
      if (this._mode() === "once-clear") this._playOnceAndClear(false);
      else { this._playIn(false); this.currentStep = 0; }
      return { statusCode: 200 };
    }
    return { statusCode: 404, statusMessage: `Unknown action: ${params?.id}` };
  }

  async goToTime() { return { statusCode: 400, statusMessage: "Non-realtime not supported" }; }
  async setActionsSchedule() { return { statusCode: 400, statusMessage: "Non-realtime not supported" }; }
}
