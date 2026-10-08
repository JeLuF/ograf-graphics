// DTB Top Banner - OGraf web component
const KEYS = ["text", "width", "height"];

// Width/height are entered in pixels for a 1920 px wide screen and scaled with the screen (via vw).
const PX_PER_VW = 19.2;
const DEFAULT_WIDTH_PX = 1100;
const DEFAULT_HEIGHT_PX = 70;

// Proportions relative to the banner height
const FONT_RATIO = 0.47;      // font size
const INSET_RATIO = 0.61;     // how far each slanted side moves inward towards the bottom
const TOP_R_RATIO = 0.56;     // concave corner radius that blends the banner into the top edge
const BOTTOM_R_RATIO = 0.33;  // convex corner radius of the bottom corners
const PAD_RATIO = 1.7;        // horizontal text padding
const MIN_WIDTH_RATIO = 5;    // the banner is never narrower than 5x its height

const U = 20; // SVG units per vw, keeps the SVG proportions independent of the screen size

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const unit = (v) => { const l = Math.hypot(v[0], v[1]); return [v[0] / l, v[1] / l]; };
const add = (p, v, k) => [p[0] + v[0] * k, p[1] + v[1] * k];
const pt = (p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
const num = (v, fallback) => {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

// Rounded corner at P between neighbours A (before) and B (after); r = distance from P along each edge.
function corner(P, A, B, r) {
  return { start: add(P, unit(sub(A, P)), r), ctrl: P, end: add(P, unit(sub(B, P)), r) };
}

function geometry(widthPx, heightPx) {
  const hVw = heightPx / PX_PER_VW;
  const wVw = Math.min(Math.max(widthPx / PX_PER_VW, hVw * MIN_WIDTH_RATIO), 100);
  const W = wVw * U, H = hVw * U;
  const I = H * INSET_RATIO, t = H * TOP_R_RATIO, r = H * BOTTOM_R_RATIO;
  // Trapezoid corners; the top ones sit t units inside the shape so the concave arcs end exactly at x=0 / x=W.
  const PL = [t, 0], PR = [W - t, 0];
  const BL = [t + I, H], BR = [W - t - I, H];
  const far = 100000;
  const cTL = corner(PL, [PL[0] - far, 0], BL, t); // concave: blends into the top edge
  const cBL = corner(BL, PL, BR, r);
  const cBR = corner(BR, BL, PR, r);
  const cTR = corner(PR, BR, [PR[0] + far, 0], t);
  const d = `M${pt(cTL.start)} Q${pt(cTL.ctrl)} ${pt(cTL.end)}`
    + ` L${pt(cBL.start)} Q${pt(cBL.ctrl)} ${pt(cBL.end)}`
    + ` L${pt(cBR.start)} Q${pt(cBR.ctrl)} ${pt(cBR.end)}`
    + ` L${pt(cTR.start)} Q${pt(cTR.ctrl)} ${pt(cTR.end)} Z`;
  return { d, viewW: W, viewH: H, wVw, hVw, fontVw: hVw * FONT_RATIO, padVw: hVw * PAD_RATIO };
}

const TEMPLATE = `
<style>
  :host { position: absolute; inset: 0; display: block; overflow: hidden;
          pointer-events: none; font-family: "Helvetica Neue", Arial, sans-serif; }
  .banner {
    position: absolute; top: 0; left: 50%;
    transform: translateY(calc(-100% - 2vw));
    transition: transform .55s cubic-bezier(.2,.8,.2,1);
    filter: drop-shadow(0 .25vw .6vw rgba(0,0,0,.35));
  }
  .banner.visible { transform: translateY(0); }
  .banner.instant { transition: none; }
  svg.shape { display: block; width: 100%; height: 100%; }
  .fill { fill: #fff; }
  .content { position: absolute; top: 0; bottom: .1vw; display: flex; align-items: center; justify-content: center; color: #000; }
  .text { font-weight: 800; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
</style>
<div class="banner">
  <svg class="shape" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none"><path class="fill"/></svg>
  <div class="content"><div class="text"></div></div>
</div>
`;

export default class DtbTopBanner extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = TEMPLATE;
    this.banner = this.shadowRoot.querySelector(".banner");
    this.data = { text: "", width: DEFAULT_WIDTH_PX, height: DEFAULT_HEIGHT_PX };
    this._render();
  }

  _render() {
    const $ = (sel) => this.shadowRoot.querySelector(sel);
    const g = geometry(num(this.data.width, DEFAULT_WIDTH_PX), num(this.data.height, DEFAULT_HEIGHT_PX));
    this.banner.style.width = `${g.wVw}vw`;
    this.banner.style.height = `${g.hVw}vw`;
    this.banner.style.marginLeft = `-${g.wVw / 2}vw`;
    const svg = $("svg.shape");
    svg.setAttribute("viewBox", `0 0 ${g.viewW} ${g.viewH}`);
    $(".fill").setAttribute("d", g.d);
    const content = $(".content");
    content.style.left = content.style.right = `${g.padVw}vw`;
    const text = $(".text");
    text.style.fontSize = `${g.fontVw}vw`;
    text.textContent = this.data.text ?? "";
  }

  _setVisible(visible, skip) {
    this.banner.classList.toggle("instant", !!skip);
    void this.banner.offsetWidth;
    this.banner.classList.toggle("visible", visible);
  }

  _merge(data) {
    if (data && typeof data === "object") for (const k of KEYS) if (k in data) this.data[k] = data[k];
    this._render();
  }

  async load(params) {
    this._merge(params?.data);
    return { statusCode: 200 };
  }

  async dispose() {
    this.shadowRoot.innerHTML = "";
    return { statusCode: 200 };
  }

  async updateAction(params) {
    this._merge(params?.data);
    return { statusCode: 200 };
  }

  async playAction(params) {
    this._setVisible(true, params?.skipAnimation);
    return { statusCode: 200 };
  }

  async stopAction(params) {
    this._setVisible(false, params?.skipAnimation);
    return { statusCode: 200 };
  }

  async customAction(params) {
    return { statusCode: 404, statusMessage: `Unknown action: ${params?.id}` };
  }
}

