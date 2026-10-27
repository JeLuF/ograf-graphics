// DTB Dual Lower Third - OGraf web component
const DEFAULTS = {
  show: "both",
  leftLine1: "", leftLine2: "",
  rightLine1: "", rightLine2: "",
};

const DEFAULT_LOGO = "./assets/logo.svg";
// Logo path from the "logo" field, resolved relative to this module (absolute URLs pass through).
function logoUrl(path) {
  try { return new URL(String(path || DEFAULT_LOGO), import.meta.url).href; }
  catch { return new URL(DEFAULT_LOGO, import.meta.url).href; }
}

// Colour fields -> CSS custom properties on the host; invalid or empty values fall back to the defaults in :host.
const COLORS = { backgroundColor: "--bg", textColor: "--fg" };
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
          pointer-events: none; font-family: "Helvetica Neue", Arial, sans-serif; --bg: #fff; --fg: #000; }
  .sticker {
    position: absolute; bottom: 7%;
    display: flex; align-items: stretch; max-width: 44%;
    background: var(--bg); color: var(--fg);
    box-shadow: 0 0.3vw 1vw rgba(0,0,0,.35);
    /* slide out: fade only during the last .35s of the slide */
    opacity: 0; transition: transform var(--out, .5s) cubic-bezier(.2,.8,.2,1), opacity .35s ease max(0s, calc(var(--out, .5s) - .35s));
  }
  .sticker.left  { left: 3%;  transform: translateX(-120%); }
  .sticker.right { right: 3%; flex-direction: row-reverse; transform: translateX(120%); }
  .sticker.visible { opacity: 1; transform: translateX(0);
    transition: transform var(--in, .5s) cubic-bezier(.2,.8,.2,1), opacity .35s ease; }
  .sticker.instant { transition: none; }
  .logo { flex: none; width: 4.6vw; padding: .8vw 0 .8vw 1vw; display: flex; align-items: center; justify-content: center; }
  .right .logo { padding: .8vw 1vw .8vw 0; }
  .logo img { width: 3.6vw; height: 3.6vw; display: block; object-fit: contain; }
  .text { padding: .9vw 1.6vw; display: flex; flex-direction: column; justify-content: center; min-width: 0; }
  .right .text { text-align: right; }
  .l1 { font-size: 2.1vw; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .l2 { font-size: 1.4vw; font-weight: 400; margin-top: .25vw; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .l2:empty { display: none; }
</style>
${["left", "right"].map(s => `
<div class="sticker ${s}">
  <div class="logo"><img alt=""></div>
  <div class="text"><div class="l1"></div><div class="l2"></div></div>
</div>`).join("")}
`;

export default class DtbDualLowerThird extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = TEMPLATE;
    this.els = {
      left: this.shadowRoot.querySelector(".left"),
      right: this.shadowRoot.querySelector(".right"),
    };
    this.data = { ...DEFAULTS };
    this.playing = false;
    this._applyLogo();
  }

  _applyLogo() {
    const url = logoUrl(this.data.logo);
    for (const img of this.shadowRoot.querySelectorAll(".logo img")) if (img.src !== url) img.src = url;
  }

  // Show the side(s) selected in data.show (used by Play and by Update while on air)
  _applyShow(skip) {
    const show = this.data.show;
    return Promise.all([
      this._setVisible("left", show === "both" || show === "left", skip),
      this._setVisible("right", show === "both" || show === "right", skip),
    ]);
  }

  _applyText() {
    const d = this.data;
    const set = (side, l1, l2) => {
      this.els[side].querySelector(".l1").textContent = l1 ?? "";
      this.els[side].querySelector(".l2").textContent = l2 ?? "";
    };
    set("left", d.leftLine1, d.leftLine2);
    set("right", d.rightLine1, d.rightLine2);
  }

  _setVisible(side, visible, skipAnimation) {
    const el = this.els[side];
    el.classList.toggle("instant", !!skipAnimation);
    // force style flush so 'instant' is honoured before the class change
    void el.offsetWidth;
    const changed = el.classList.contains("visible") !== visible;
    el.classList.toggle("visible", visible);
    if (skipAnimation || !changed) return Promise.resolve();
    // Resolve only once the slide has finished: the host may remove the graphic as soon as the action resolves.
    const secs = parseFloat(getComputedStyle(el).transitionDuration) || 0;
    return new Promise((r) => setTimeout(r, secs * 1000 + (visible ? 0 : 50)));
  }

  _mergeData(data) {
    const prevShow = this.data.show;
    if (data && typeof data === "object") this.data = { ...this.data, ...data };
    if (!["both", "left", "right"].includes(this.data.show)) this.data.show = "both";
    this._applyText();
    this._applyLogo();
    applyColors(this, this.data);
    for (const [key, prop] of [["slideInDuration", "--in"], ["slideOutDuration", "--out"]]) {
      const v = parseFloat(String(this.data[key] ?? "").replace(",", "."));
      if (Number.isFinite(v) && v >= 0) this.style.setProperty(prop, `${v}s`); else this.style.removeProperty(prop);
    }
    return this.data.show !== prevShow;
  }

  async load(params) {
    this.data = { ...DEFAULTS };
    this._mergeData(params?.data);
    return { statusCode: 200 };
  }

  async dispose() {
    this.shadowRoot.innerHTML = "";
    return { statusCode: 200 };
  }

  async updateAction(params) {
    const showChanged = this._mergeData(params?.data);
    // Changing the "show" field while on air brings sides in/out
    if (showChanged && this.playing) await this._applyShow(params?.skipAnimation);
    return { statusCode: 200 };
  }

  // Default "play": bring in the side(s) selected in the "show" field
  async playAction(params) {
    this.playing = true;
    await this._applyShow(params?.skipAnimation);
    return { statusCode: 200 };
  }

  // Default "stop": take everything out
  async stopAction(params) {
    this.playing = false;
    await Promise.all([
      this._setVisible("left", false, params?.skipAnimation),
      this._setVisible("right", false, params?.skipAnimation),
    ]);
    return { statusCode: 200 };
  }

  async customAction(params) {
    const skip = params?.skipAnimation;
    if (params?.id !== "hide") this.playing = true;
    else this.playing = false;
    switch (params?.id) {
      case "showLeft":  await this._setVisible("left", true, skip); break;
      case "showRight": await this._setVisible("right", true, skip); break;
      case "showBoth":
        await Promise.all([this._setVisible("left", true, skip), this._setVisible("right", true, skip)]);
        break;
      case "hide":
        await Promise.all([this._setVisible("left", false, skip), this._setVisible("right", false, skip)]);
        break;
      default:
        return { statusCode: 404, statusMessage: `Unknown action: ${params?.id}` };
    }
    return { statusCode: 200 };
  }

  async goToTime() { return { statusCode: 400, statusMessage: "Non-realtime not supported" }; }
  async setActionsSchedule() { return { statusCode: 400, statusMessage: "Non-realtime not supported" }; }
}
