// DTB Schedule Panel - OGraf web component
const ROWS = 8;   // rows shown (first 8 non-empty entries)
const KEYS = ["logo", "backgroundColor", "textColor", "accentColor", "delay", "title", "leftHeader", "rightHeader", "footer", "schedule", "slideInDuration", "slideOutDuration"];

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

// Schedule entry { time, event1, subline1, event2, subline2 } -> row data; null if all fields are empty.
function parseEntry(e) {
  const t = (v) => String(v ?? "").trim();
  const time = t(e?.time), left = { event: t(e?.event1), sub: t(e?.subline1) }, right = { event: t(e?.event2), sub: t(e?.subline2) };
  if (!time && !left.event && !left.sub && !right.event && !right.sub) return null;
  return { time, left, right };
}

const DEFAULT_LOGO = "./assets/logo.svg";
// Logo path from the "logo" field, resolved relative to this module (absolute URLs pass through).
function logoUrl(path) {
  try { return new URL(String(path || DEFAULT_LOGO), import.meta.url).href; }
  catch { return new URL(DEFAULT_LOGO, import.meta.url).href; }
}

const rowsHtml = Array.from({ length: ROWS }, (_, i) => `
  <div class="row grid" data-row="${i + 1}" style="--i:${i}">
    <div class="t"></div>
    <div class="a"><div class="ev"></div><div class="sub"></div></div>
    <div class="b"><div class="ev"></div><div class="sub"></div></div>
  </div>`).join("");

// Colour fields -> CSS custom properties on the host; invalid or empty values fall back to the defaults in :host.
const COLORS = { backgroundColor: "--bg", textColor: "--fg", accentColor: "--accent" };
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
          pointer-events: none; font-family: "Helvetica Neue", Arial, sans-serif; --bg: #fff; --fg: #000; --accent: #e30613; }
  .panel {
    position: absolute; top: 0; right: 0; bottom: 0; width: 33.333%;
    box-sizing: border-box; padding: 1.6vw 1.4vw 1.4vw 1.6vw;
    display: flex; flex-direction: column;
    background: var(--bg); color: var(--fg);
    box-shadow: -0.3vw 0 1vw rgba(0,0,0,.35);
    transform: translateX(105%);
    transition: transform var(--out, .6s) cubic-bezier(.2,.8,.2,1);
  }
  .panel.visible { transform: translateX(0); transition-duration: var(--in, .6s); }
  .header { display: flex; align-items: center; gap: 1vw; }
  .logo img { width: 3.6vw; height: 3.6vw; display: block; object-fit: contain; }
  .title { font-size: 2vw; font-weight: 800; line-height: 1.1; }
  .grid { display: grid; grid-template-columns: 4.6vw 1fr 1fr; column-gap: .8vw; }
  .cols {
    margin-top: 1.2vw; padding-bottom: .5vw; border-bottom: .2vw solid var(--accent);
    font-size: .85vw; font-weight: 700; letter-spacing: .08vw; text-transform: uppercase;
  }
  .rows { flex: 1; display: grid; grid-template-rows: repeat(8, minmax(0, 1fr)); min-height: 0; }
  .row {
    align-items: center; min-height: 0; padding: 0; border-bottom: .08vw solid color-mix(in srgb, var(--fg) 19%, var(--bg));
    opacity: 0; transform: translateX(2vw);
    transition: opacity .3s ease var(--out, .6s), transform .3s ease var(--out, .6s); /* hide only after the panel has slid out */
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
  .sub { font-size: 1.2vw; font-weight: 400; line-height: 1.15; color: color-mix(in srgb, var(--fg) 60%, var(--bg)); margin-top: .2vw; }
  .sub:empty { display: none; }
  .footer {
    margin-top: .8vw; padding-top: .8vw; border-top: .08vw solid color-mix(in srgb, var(--fg) 19%, var(--bg));
    font-size: 1vw; line-height: 1.25; color: color-mix(in srgb, var(--fg) 73%, var(--bg));
    opacity: 0; transition: opacity .3s ease var(--out, .6s);
  }
  .footer:empty { display: none; }
  .visible .footer { opacity: 1; transition: opacity .5s ease .9s; }
  .paging .row { opacity: 0; transition: opacity .3s ease; transition-delay: 0s; }
  .instant, .instant .row, .instant .footer { transition: none !important; }
</style>
<div class="panel">
  <div class="header"><div class="logo"><img alt=""></div><div class="title"></div></div>
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
    this.page = 0;
    this._applyLogo();
  }

  _applyLogo() {
    const url = logoUrl(this.data.logo);
    for (const img of this.shadowRoot.querySelectorAll(".logo img")) if (img.src !== url) img.src = url;
  }

  _render() {
    const $ = (sel) => this.shadowRoot.querySelector(sel);
    const d = this.data;
    this._applyLogo();
    applyColors(this, d);
    for (const [key, prop] of [["slideInDuration", "--in"], ["slideOutDuration", "--out"]]) {
      const v = parseFloat(String(d[key] ?? "").replace(",", "."));
      if (Number.isFinite(v) && v >= 0) this.style.setProperty(prop, `${v}s`); else this.style.removeProperty(prop);
    }
    $(".title").textContent = d.title ?? "";
    $(".lh").textContent = d.leftHeader ?? "";
    $(".rh").textContent = d.rightHeader ?? "";
    $(".footer").textContent = d.footer ?? "";
    const n = Math.round(Number(String(d.delay ?? "0").replace(",", ".")));
    const delay = Number.isFinite(n) ? n : 0;
    // Non-empty entries of the schedule array, shown ROWS per page; each row gets 1/8 of the height.
    const all = (Array.isArray(d.schedule) ? d.schedule : []).map(parseEntry).filter(Boolean);
    this.pageCount = Math.max(1, Math.ceil(all.length / ROWS));
    if (this.page >= this.pageCount) this.page = 0;
    const parsed = all.slice(this.page * ROWS, (this.page + 1) * ROWS);
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
    if (skip) return;
    // Resolve only once the slide has finished: the host may remove the graphic as soon as stopAction resolves.
    const secs = parseFloat(getComputedStyle(this.panel).transitionDuration) || 0;
    const ms = secs * 1000 + (visible ? 0 : 50);
    return new Promise((r) => setTimeout(r, ms));
  }

  _merge(data) {
    if (data && typeof data === "object") {
      for (const k of KEYS) if (k in data) this.data[k] = data[k];
    }
    this._render();
  }

  async load(params) {
    this.data = {};
    this.page = 0;
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
    await this._setVisible(true, params?.skipAnimation);
    return { statusCode: 200 };
  }

  async stopAction(params) {
    await this._setVisible(false, params?.skipAnimation);
    return { statusCode: 200 };
  }

  async customAction(params) {
    if (params?.id === "nextPage") {
      this.panel.classList.add("paging");
      await new Promise((r) => setTimeout(r, params?.skipAnimation ? 0 : 300));
      this.page = (this.page + 1) % (this.pageCount || 1);
      this._render();
      void this.panel.offsetWidth; // commit the new rows while hidden, then fade them in
      this.panel.classList.remove("paging");
      return { statusCode: 200 };
    }
    return { statusCode: 404, statusMessage: `Unknown action: ${params?.id}` };
  }
}
