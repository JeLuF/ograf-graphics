// DTB Warmup Countdown - OGraf web component
const KEYS = ["title", "subtitle", "position", "duration", "endTime", "finishedText"];
const POSITIONS = ["top-left", "bottom-left", "top-right", "bottom-right"];

const LOGO = `<svg viewBox="0 0 100 100" aria-label="DTB Turnerkreuz"><defs><path id="f" d="M0 0H44V11H12V18H34V29H12V46H0Z"/></defs><use href="#f" transform="translate(46 46) scale(-1 -1)"/><use href="#f" transform="translate(54 46) scale(1 -1)"/><use href="#f" transform="translate(46 54) scale(-1 1)"/><use href="#f" transform="translate(54 54)"/></svg>`;

// "H:MM" / "HH:MM" -> epoch ms of that time today (local). If it lies more than 12h in the past, use tomorrow.
function targetFromClock(str, now = Date.now()) {
  const m = String(str ?? "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const d = new Date(now);
  d.setHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0);
  let t = d.getTime();
  if (t < now - 12 * 3600 * 1000) t += 24 * 3600 * 1000;
  return t;
}

function formatRemaining(ms) {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const mm = String(m).padStart(2, "0"), ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const TEMPLATE = `
<style>
  :host { position: absolute; inset: 0; display: block; overflow: hidden;
          pointer-events: none; font-family: "Helvetica Neue", Arial, sans-serif; }
  .card {
    position: absolute; width: 24vw;
    display: flex; align-items: stretch; overflow: hidden;
    background: #fff; color: #000; box-shadow: 0 0.3vw 1vw rgba(0,0,0,.35);
    opacity: 0;
    transition: transform .5s cubic-bezier(.2,.8,.2,1), opacity .35s ease;
  }
  .card.top    { top: 4%; }
  .card.bottom { bottom: 4%; }
  .card.left   { left: 3%;  transform: translateX(-120%); }
  .card.right  { right: 3%; transform: translateX(120%); }
  .card.visible { opacity: 1; transform: translateX(0); }
  .card.instant { transition: none; }
  .logo { flex: none; width: 4.6vw; padding: .8vw 0 .8vw 1vw; display: flex; align-items: center; justify-content: center; }
  .logo svg { width: 3.6vw; height: 3.6vw; display: block; fill: #e30613; }
  .text { flex: 1; min-width: 0; padding: .8vw 1.4vw .9vw 1.2vw; }
  .title { font-size: 1.3vw; font-weight: 800; letter-spacing: .1vw; text-transform: uppercase; }
  .status { font-size: 1.1vw; line-height: 1.2; color: #666; min-height: 1.3vw; }
  .time { font-size: 4vw; font-weight: 800; line-height: 1.05; margin-top: .2vw;
          font-variant-numeric: tabular-nums; }
  .time.urgent { color: #e30613; }
  .bar { position: absolute; left: 0; bottom: 0; height: .35vw; width: 100%; background: #e30613;
         transform-origin: left center; }
</style>
<div class="card">
  <div class="logo">${LOGO}</div>
  <div class="text">
    <div class="title"></div>
    <div class="status"></div>
    <div class="time">00:00</div>
  </div>
  <div class="bar"></div>
</div>
`;

export default class DtbWarmupCountdown extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = TEMPLATE;
    this.card = this.shadowRoot.querySelector(".card");
    this.data = { title: "", subtitle: "", position: "top-left", duration: 15, endTime: "", finishedText: "" };
    this.running = false;
    this.target = 0;
    this.total = 1;
    this.timer = null;
    this._applyPosition();
  }

  // Corner placement; the card slides in from the nearest side edge.
  _applyPosition() {
    const p = String(this.data.position ?? "").trim().toLowerCase().replace(/[\s_]+/g, "-");
    const [v, h] = (POSITIONS.includes(p) ? p : "top-left").split("-");
    this.card.classList.remove("top", "bottom", "left", "right");
    this.card.classList.add(v, h);
  }

  // Where would the countdown end, if started now?
  _plan() {
    const now = Date.now();
    const clock = targetFromClock(this.data.endTime, now);
    if (clock !== null) return { target: clock, total: Math.max(clock - now, 1) };
    const n = Number(String(this.data.duration ?? "").replace(",", "."));
    const minutes = Number.isFinite(n) && n > 0 ? n : 0;
    return { target: now + minutes * 60000, total: Math.max(minutes * 60000, 1) };
  }

  _start() {
    const { target, total } = this._plan();
    this.target = target;
    this.total = total;
    this.running = true;
    clearInterval(this.timer);
    this.timer = setInterval(() => this._tick(), 200);
    this._tick();
  }

  _halt() {
    this.running = false;
    clearInterval(this.timer);
    this.timer = null;
    this._tick();
  }

  _tick() {
    const $ = (sel) => this.shadowRoot.querySelector(sel);
    if (!$(".card")) return;
    const target = this.running ? this.target : this._plan().target;
    const total = this.running ? this.total : this._plan().total;
    const remaining = Math.max(0, target - Date.now());
    const finished = this.running && remaining === 0;
    const timeEl = $(".time");
    timeEl.textContent = formatRemaining(remaining);
    timeEl.classList.toggle("urgent", this.running && remaining <= 60000);
    $(".bar").style.transform = `scaleX(${this.running ? Math.min(1, remaining / total) : 1})`;
    $(".title").textContent = this.data.title ?? "";
    $(".status").textContent = finished ? (this.data.finishedText ?? "") : (this.data.subtitle ?? "");
  }

  _setVisible(visible, skip) {
    this.card.classList.toggle("instant", !!skip);
    void this.card.offsetWidth;
    this.card.classList.toggle("visible", visible);
  }

  _merge(data) {
    const before = `${this.data.duration}|${this.data.endTime}`;
    if (data && typeof data === "object") for (const k of KEYS) if (k in data) this.data[k] = data[k];
    const timingChanged = before !== `${this.data.duration}|${this.data.endTime}`;
    this._applyPosition();
    if (timingChanged && this.running) this._start(); else this._tick();
  }

  async load(params) {
    this._merge(params?.data);
    return { statusCode: 200 };
  }

  async dispose() {
    clearInterval(this.timer);
    this.shadowRoot.innerHTML = "";
    return { statusCode: 200 };
  }

  async updateAction(params) {
    this._merge(params?.data);
    return { statusCode: 200 };
  }

  async playAction(params) {
    this._start();
    this._setVisible(true, params?.skipAnimation);
    return { statusCode: 200 };
  }

  async stopAction(params) {
    this._setVisible(false, params?.skipAnimation);
    // stop ticking once the slide-out has finished
    setTimeout(() => { if (!this.card.classList.contains("visible")) this._halt(); }, params?.skipAnimation ? 0 : 700);
    return { statusCode: 200 };
  }

  async customAction(params) {
    if (params?.id === "restart") { this._start(); return { statusCode: 200 }; }
    return { statusCode: 404, statusMessage: `Unknown action: ${params?.id}` };
  }
}

