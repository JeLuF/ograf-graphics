// DTB Dual Lower Third - OGraf web component
const DEFAULTS = {
  show: "both",
  leftLine1: "", leftLine2: "",
  rightLine1: "", rightLine2: "",
};

const TEMPLATE = `
<style>
  :host { position: absolute; inset: 0; display: block; overflow: hidden;
          pointer-events: none; font-family: "Helvetica Neue", Arial, sans-serif; }
  .sticker {
    position: absolute; bottom: 7%;
    display: flex; align-items: stretch; max-width: 44%;
    background: #fff; color: #000;
    box-shadow: 0 0.3vw 1vw rgba(0,0,0,.35);
    opacity: 0; transition: transform .5s cubic-bezier(.2,.8,.2,1), opacity .35s ease;
  }
  .sticker.left  { left: 3%;  transform: translateX(-120%); }
  .sticker.right { right: 3%; flex-direction: row-reverse; transform: translateX(120%); }
  .sticker.visible { opacity: 1; transform: translateX(0); }
  .sticker.instant { transition: none; }
  .logo { flex: none; width: 4.6vw; padding: .8vw 0 .8vw 1vw; display: flex; align-items: center; justify-content: center; }
  .right .logo { padding: .8vw 1vw .8vw 0; }
  .logo svg { width: 3.6vw; height: 3.6vw; display: block; fill: #e30613; }
  .text { padding: .9vw 1.6vw; display: flex; flex-direction: column; justify-content: center; min-width: 0; }
  .right .text { text-align: right; }
  .l1 { font-size: 2.1vw; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .l2 { font-size: 1.4vw; font-weight: 400; margin-top: .25vw; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .l2:empty { display: none; }
</style>
${["left", "right"].map(s => `
<div class="sticker ${s}">
  <div class="logo"><svg viewBox="0 0 100 100" aria-label="DTB Turnerkreuz"><defs><path id="f" d="M0 0H44V11H12V18H34V29H12V46H0Z"/></defs><use href="#f" transform="translate(46 46) scale(-1 -1)"/><use href="#f" transform="translate(54 46) scale(1 -1)"/><use href="#f" transform="translate(46 54) scale(-1 1)"/><use href="#f" transform="translate(54 54)"/></svg></div>
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
  }

  // Show the side(s) selected in data.show (used by Play and by Update while on air)
  _applyShow(skip) {
    const show = this.data.show;
    this._setVisible("left", show === "both" || show === "left", skip);
    this._setVisible("right", show === "both" || show === "right", skip);
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
    el.classList.toggle("visible", visible);
  }

  _mergeData(data) {
    const prevShow = this.data.show;
    if (data && typeof data === "object") this.data = { ...this.data, ...data };
    if (!["both", "left", "right"].includes(this.data.show)) this.data.show = "both";
    this._applyText();
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
    if (showChanged && this.playing) this._applyShow(params?.skipAnimation);
    return { statusCode: 200 };
  }

  // Default "play": bring in the side(s) selected in the "show" field
  async playAction(params) {
    this.playing = true;
    this._applyShow(params?.skipAnimation);
    return { statusCode: 200 };
  }

  // Default "stop": take everything out
  async stopAction(params) {
    this.playing = false;
    this._setVisible("left", false, params?.skipAnimation);
    this._setVisible("right", false, params?.skipAnimation);
    return { statusCode: 200 };
  }

  async customAction(params) {
    const skip = params?.skipAnimation;
    if (params?.id !== "hide") this.playing = true;
    else this.playing = false;
    switch (params?.id) {
      case "showLeft":  this._setVisible("left", true, skip); break;
      case "showRight": this._setVisible("right", true, skip); break;
      case "showBoth":
        this._setVisible("left", true, skip);
        this._setVisible("right", true, skip);
        break;
      case "hide":
        this._setVisible("left", false, skip);
        this._setVisible("right", false, skip);
        break;
      default:
        return { statusCode: 404, statusMessage: `Unknown action: ${params?.id}` };
    }
    return { statusCode: 200 };
  }

  async goToTime() { return { statusCode: 400, statusMessage: "Non-realtime not supported" }; }
  async setActionsSchedule() { return { statusCode: 400, statusMessage: "Non-realtime not supported" }; }
}

