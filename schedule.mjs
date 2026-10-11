// DTB Schedule Panel - OGraf web component
const LINES = 15; // input fields
const ROWS = 8;   // rows shown (first 8 non-empty lines)
const KEYS = ["delay", "title", "leftHeader", "rightHeader", "footer"];
for (let i = 1; i <= LINES; i++) KEYS.push(`line${i}`);

// Shifts a H:MM / HH:MM time by `delay` minutes (may be negative, wraps around midnight).
// Keeps the leading-zero style of the original hour; unparsable values are returned unchanged.
function shiftTime(time, delay) {
  const m = String(time).match(/^(\d{1,2}):(\d{2})$/);
  if (!m || !delay) return time;
  const total = ((parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + delay) % 1440 + 1440) % 1440;
  const h = Math.floor(total / 60), min = total % 60;
  const hh = m[1].length === 2 ? String(h).padStart(2, "0") : String(h);
  return `${hh}:${String(min).padStart(2, "0")}`;
}

// Parses "time event1 (subline1) - event2 (subline2)".
// Time = first word. The separator is the dash that follows the first closing bracket;
// without brackets, the first " - " is used. Sublines are optional when parsing.
function parseLine(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const m = text.match(/^(\S+)\s*(.*)$/);
  const time = m[1];
  const rest = m[2];
  let left = rest, right = "";
  const sep = rest.match(/\)\s*-\s*/) || rest.match(/\s-\s/);
  if (sep) {
    const cut = sep.index + (sep[0].includes(")") ? 1 : 0);
    left = rest.slice(0, cut);
    right = rest.slice(sep.index + sep[0].length);
  }
  const part = (str) => {
    const mm = str.trim().match(/^(.*?)\s*\(([^)]*)\)\s*$/);
    return mm ? { event: mm[1].trim(), sub: mm[2].trim() } : { event: str.trim(), sub: "" };
  };
  return { time, left: part(left), right: part(right) };
}

const LOGO = `<svg viewBox="0 0 100 100" aria-label="DTB Turnerkreuz"><defs><path id="f" d="M0 0H44V11H12V18H34V29H12V46H0Z"/></defs><use href="#f" transform="translate(46 46) scale(-1 -1)"/><use href="#f" transform="translate(54 46) scale(1 -1)"/><use href="#f" transform="translate(46 54) scale(-1 1)"/><use href="#f" transform="translate(54 54)"/></svg>`;

const rowsHtml = Array.from({ length: ROWS }, (_, i) => `
  <div class="row grid" data-row="${i + 1}" style="--i:${i}">
    <div class="t"></div>
    <div class="a"><div class="ev"></div><div class="sub"></div></div>
    <div class="b"><div class="ev"></div><div class="sub"></div></div>
  </div>`).join("");

const TEMPLATE = `
<style>
  :host { position: absolute; inset: 0; display: block; overflow: hidden;
          pointer-events: none; font-family: "Helvetica Neue", Arial, sans-serif; }
  .panel {
    position: absolute; top: 0; right: 0; bottom: 0; width: 33.333%;
    box-sizing: border-box; padding: 1.6vw 1.4vw 1.4vw 1.6vw;
    display: flex; flex-direction: column;
    background: #fff; color: #000;
    box-shadow: -0.3vw 0 1vw rgba(0,0,0,.35);
    transform: translateX(105%);
    transition: transform .6s cubic-bezier(.2,.8,.2,1);
  }
  .panel.visible { transform: translateX(0); }
  .header { display: flex; align-items: center; gap: 1vw; }
  .logo svg { width: 3.6vw; height: 3.6vw; display: block; fill: #e30613; }
  .title { font-size: 2vw; font-weight: 800; line-height: 1.1; }
  .grid { display: grid; grid-template-columns: 4.6vw 1fr 1fr; column-gap: .8vw; }
  .cols {
    margin-top: 1.2vw; padding-bottom: .5vw; border-bottom: .2vw solid #e30613;
    font-size: .85vw; font-weight: 700; letter-spacing: .08vw; text-transform: uppercase;
  }
  .rows { flex: 1; display: grid; grid-template-rows: repeat(8, minmax(0, 1fr)); min-height: 0; }
  .row {
    align-items: center; min-height: 0; padding: 0; border-bottom: .08vw solid #cfcfcf;
    opacity: 0; transform: translateX(2vw);
    transition: opacity .3s ease, transform .3s ease;
  }
  .row.empty { visibility: hidden; }
  .row.last { border-bottom: none; }
  .visible .row {
    opacity: 1; transform: translateX(0);
    transition: opacity .45s ease, transform .45s cubic-bezier(.2,.8,.2,1);
    transition-delay: calc(.3s + var(--i) * .08s);
  }
  .t { font-size: 1.4vw; font-weight: 800; line-height: 1.15; }
  .a, .b { overflow-wrap: anywhere; }
  .ev { font-size: 1.2vw; font-weight: 700; line-height: 1.15; }
  .sub { font-size: 1.2vw; font-weight: 400; line-height: 1.15; color: #666; margin-top: .2vw; }
  .sub:empty { display: none; }
  .footer {
    margin-top: .8vw; padding-top: .8vw; border-top: .08vw solid #cfcfcf;
    font-size: 1vw; line-height: 1.25; color: #444;
    opacity: 0; transition: opacity .3s ease;
  }
  .footer:empty { display: none; }
  .visible .footer { opacity: 1; transition: opacity .5s ease .9s; }
  .instant, .instant .row, .instant .footer { transition: none !important; }
</style>
<div class="panel">
  <div class="header"><div class="logo">${LOGO}</div><div class="title"></div></div>
  <div class="cols grid"><div></div><div class="lh"></div><div class="rh"></div></div>
  <div class="rows">${rowsHtml}</div>
  <div class="footer"></div>
</div>
`;

export default class DtbSchedulePanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = TEMPLATE;
    this.panel = this.shadowRoot.querySelector(".panel");
    this.data = {};
  }

  _render() {
    const $ = (sel) => this.shadowRoot.querySelector(sel);
    const d = this.data;
    $(".title").textContent = d.title ?? "";
    $(".lh").textContent = d.leftHeader ?? "";
    $(".rh").textContent = d.rightHeader ?? "";
    $(".footer").textContent = d.footer ?? "";
    const n = Math.round(Number(String(d.delay ?? "0").replace(",", ".")));
    const delay = Number.isFinite(n) ? n : 0;
    // First 8 non-empty lines out of the 15 inputs; each gets 1/8 of the height.
    const parsed = [];
    for (let i = 1; i <= LINES && parsed.length < ROWS; i++) {
      const p = parseLine(d[`line${i}`]);
      if (p) parsed.push(p);
    }
    let lastRow = null;
    for (let i = 1; i <= ROWS; i++) {
      const row = $(`.row[data-row="${i}"]`);
      const p = parsed[i - 1];
      row.classList.remove("last");
      row.classList.toggle("empty", !p);
      row.style.setProperty("--i", i - 1);
      if (!p) continue;
      row.querySelector(".t").textContent = shiftTime(p.time, delay);
      row.querySelector(".a .ev").textContent = p.left.event;
      row.querySelector(".a .sub").textContent = p.left.sub;
      row.querySelector(".b .ev").textContent = p.right.event;
      row.querySelector(".b .sub").textContent = p.right.sub;
      lastRow = row;
    }
    if (lastRow) lastRow.classList.add("last");
  }

  _setVisible(visible, skip) {
    this.panel.classList.toggle("instant", !!skip);
    void this.panel.offsetWidth; // flush so 'instant' applies before the change
    this.panel.classList.toggle("visible", visible);
  }

  _merge(data) {
    if (data && typeof data === "object") {
      for (const k of KEYS) if (k in data) this.data[k] = data[k];
    }
    this._render();
  }

  async load(params) {
    this.data = {};
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

