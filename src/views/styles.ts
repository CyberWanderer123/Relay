/* Relay — "Modern infrastructure" palette.
   Ink #171923 · Canvas #F7F7F5 · Accent #7167E8 · Mint #B7E4D2 · Muted #9295A5
   Type: Instrument Serif (display), Geist (text), Geist Mono (labels, ids, code). */

export const FONT_CSS_URL =
  "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=swap";

export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#171923"/><path d="M10.5 20.5 21.5 11.5" stroke="#9295A5" stroke-width="2" stroke-linecap="round"/><circle cx="10" cy="21" r="4.25" fill="#7167E8"/><circle cx="22" cy="11" r="4.25" fill="#B7E4D2"/></svg>`;

export const CSS = String.raw`
:root {
  --ink: #171923;
  --canvas: #F7F7F5;
  --accent: #7167E8;
  --mint: #B7E4D2;
  --muted: #9295A5;

  --bg: var(--canvas);
  --surface: #FFFFFF;
  --surface-2: #EFEFEA;
  --line: #E3E3DD;
  --line-strong: #CFCFC8;
  --text: var(--ink);
  --text-2: #565A6B;
  --text-3: var(--muted);
  --primary: #5F55DF;
  --primary-hover: #4E44CF;
  --on-primary: #FFFFFF;
  --accent-soft: rgba(113, 103, 232, 0.10);
  --accent-ring: rgba(113, 103, 232, 0.32);
  --mint-soft: rgba(183, 228, 210, 0.45);
  --mint-ink: #1E5A44;
  --danger: #B23A2A;
  --danger-soft: #FBEDEA;

  --serif: "Instrument Serif", ui-serif, Georgia, "Times New Roman", serif;
  --sans: "Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --mono: "Geist Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;

  --radius: 14px;
  --radius-sm: 10px;
  --shadow: 0 1px 0 rgba(23, 25, 35, 0.03), 0 1px 3px rgba(23, 25, 35, 0.06);
  --shadow-lift: 0 1px 0 rgba(23, 25, 35, 0.03), 0 8px 24px -8px rgba(23, 25, 35, 0.14);
  color-scheme: light;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0F1016;
    --surface: #171923;
    --surface-2: #1E2130;
    --line: #2A2D3C;
    --line-strong: #3A3E50;
    --text: #EDEDF1;
    --text-2: #AEB1C0;
    --text-3: #8A8D9E;
    --primary: #7167E8;
    --primary-hover: #8279EE;
    --accent-soft: rgba(113, 103, 232, 0.16);
    --accent-ring: rgba(141, 133, 242, 0.45);
    --mint-soft: rgba(183, 228, 210, 0.12);
    --mint-ink: #B7E4D2;
    --danger: #F2937F;
    --danger-soft: rgba(242, 147, 127, 0.10);
    --shadow: 0 0 0 1px rgba(255, 255, 255, 0.02);
    --shadow-lift: 0 10px 30px -12px rgba(0, 0, 0, 0.6);
    color-scheme: dark;
  }
}

*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
body {
  margin: 0;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--text);
  font: 400 16px/1.6 var(--sans);
  font-feature-settings: "ss01", "cv11";
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
::selection { background: var(--accent-soft); }
a { color: inherit; text-underline-offset: 3px; text-decoration-thickness: 1px; }
a:hover { color: var(--primary); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 6px; }

/* ---------- chrome ---------- */
.topbar {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  width: 100%; max-width: 1080px; margin: 0 auto; padding: 20px 20px 0;
}
.brand { display: inline-flex; align-items: center; gap: 10px; text-decoration: none; color: var(--text); }
.brand:hover { color: var(--text); }
.brand svg { width: 26px; height: 26px; flex: none; }
.brand-name { font: 600 17px/1 var(--sans); letter-spacing: -0.02em; }
.topbar-meta { font: 500 12px/1 var(--mono); color: var(--text-3); letter-spacing: 0.02em; }

.shell { width: 100%; max-width: 680px; margin: 0 auto; padding: 48px 20px 64px; flex: 1; }
.shell.wide { max-width: 1080px; }

.foot {
  width: 100%; max-width: 1080px; margin: 0 auto; padding: 24px 20px 32px;
  display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px 16px;
  border-top: 1px solid var(--line);
  font-size: 13px; color: var(--text-3);
}
.foot a { color: var(--text-2); }

/* ---------- type ---------- */
.eyebrow {
  display: inline-flex; align-items: center; gap: 8px;
  margin: 0 0 16px;
  font: 500 12px/1 var(--mono); letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--text-3);
}
.eyebrow .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
.eyebrow .dot.mint { background: var(--mint); box-shadow: 0 0 0 3px var(--mint-soft); }
.display {
  margin: 0;
  font: 400 clamp(38px, 6.4vw, 56px)/1.04 var(--serif);
  letter-spacing: -0.015em;
  text-wrap: balance;
}
.display em { font-style: italic; color: var(--primary); }
.lede { margin: 16px 0 0; font-size: 17px; line-height: 1.6; color: var(--text-2); white-space: pre-line; text-wrap: pretty; }
.mono { font-family: var(--mono); font-size: 0.92em; }
.fine { font-size: 13px; color: var(--text-3); margin: 0; }
.fine .mono { color: var(--text-2); }
h2 { font: 400 32px/1.1 var(--serif); letter-spacing: -0.01em; margin: 0 0 12px; }
h3 { font: 600 15px/1.35 var(--sans); letter-spacing: -0.01em; margin: 0 0 6px; }

/* ---------- form head ---------- */
.form-head { margin-bottom: 36px; }
.form-head .meta-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 22px; }
.chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 10px; border-radius: 999px;
  font: 500 12px/1 var(--mono); color: var(--text-2);
  background: var(--surface); border: 1px solid var(--line);
}
a.chip { text-decoration: none; }
a.chip:hover { border-color: var(--accent); color: var(--primary); }
.chip svg { width: 13px; height: 13px; }

/* ---------- questions ---------- */
.questions { display: grid; gap: 14px; }
.q {
  margin: 0; min-width: 0;
  padding: 22px 22px 20px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  transition: border-color .15s ease, box-shadow .15s ease;
}
.q:focus-within { border-color: var(--accent-ring); box-shadow: 0 0 0 4px var(--accent-soft); }
.q.has-error { border-color: var(--danger); }
fieldset.q { padding-top: 22px; }
.q-head { display: block; padding: 0; margin: 0 0 14px; width: 100%; }
legend.q-head { float: left; }
legend.q-head + * { clear: both; }
.q-meta {
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 8px;
  font: 500 11px/1 var(--mono); letter-spacing: 0.06em; text-transform: uppercase;
}
.q-num { color: var(--primary); }
.q-req { color: var(--text-2); }
.q-opt { color: var(--text-3); }
.q-hint { color: var(--text-3); text-transform: none; letter-spacing: 0; font-family: var(--sans); font-size: 12px; }
.q-label { display: block; font: 500 17px/1.45 var(--sans); letter-spacing: -0.01em; color: var(--text); }

.input, .textarea {
  width: 100%;
  padding: 12px 14px;
  font: 400 16px/1.5 var(--sans);
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  transition: border-color .15s ease, background .15s ease, box-shadow .15s ease;
  appearance: none;
}
.input::placeholder, .textarea::placeholder { color: var(--text-3); }
.input:hover, .textarea:hover { border-color: var(--line-strong); }
.input:focus, .textarea:focus { outline: none; border-color: var(--accent); background: var(--surface); box-shadow: 0 0 0 3px var(--accent-soft); }
.textarea { min-height: 132px; resize: vertical; }

.options { display: grid; gap: 8px; }
.opt {
  position: relative;
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--bg);
  cursor: pointer;
  transition: border-color .15s ease, background .15s ease;
}
.opt:hover { border-color: var(--line-strong); }
.opt input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.opt-mark {
  flex: none; display: grid; place-items: center;
  width: 18px; height: 18px;
  border: 1.5px solid var(--line-strong);
  background: var(--surface);
  transition: all .15s ease;
}
.opt-mark.radio { border-radius: 50%; }
.opt-mark.check { border-radius: 5px; }
.opt-mark::after { content: ""; opacity: 0; transition: opacity .12s ease; }
.opt-mark.radio::after { width: 8px; height: 8px; border-radius: 50%; background: var(--on-primary); }
.opt-mark.check::after {
  width: 9px; height: 5px; margin-top: -2px;
  border: solid var(--on-primary); border-width: 0 0 2px 2px; transform: rotate(-45deg);
}
.opt-text { font-size: 15.5px; line-height: 1.4; }
.opt:has(input:checked) { border-color: var(--accent); background: var(--accent-soft); }
.opt input:checked + .opt-mark { background: var(--primary); border-color: var(--primary); }
.opt input:checked + .opt-mark::after { opacity: 1; }
.opt input:focus-visible + .opt-mark { box-shadow: 0 0 0 3px var(--accent-ring); }

.q-error { display: flex; gap: 6px; align-items: baseline; margin: 10px 0 0; font-size: 14px; color: var(--danger); }
.q-error::before { content: "●"; font-size: 8px; transform: translateY(-2px); }

.hp { position: absolute !important; left: -10000px; width: 1px; height: 1px; overflow: hidden; }

/* ---------- actions ---------- */
.actions {
  display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px;
  margin-top: 28px; padding-top: 24px; border-top: 1px solid var(--line);
}
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  min-height: 48px; padding: 0 22px;
  font: 600 15px/1 var(--sans); letter-spacing: -0.01em;
  border-radius: 12px; border: 1px solid transparent;
  cursor: pointer; text-decoration: none;
  transition: background .15s ease, border-color .15s ease, transform .05s ease;
}
.btn:active { transform: translateY(1px); }
.btn svg { width: 16px; height: 16px; }
.btn-primary { background: var(--primary); color: var(--on-primary); box-shadow: 0 1px 0 rgba(255,255,255,.15) inset, 0 6px 16px -8px rgba(95, 85, 223, .7); }
.btn-primary:hover { background: var(--primary-hover); color: var(--on-primary); }
.btn-ghost { background: var(--surface); color: var(--text); border-color: var(--line); }
.btn-ghost:hover { border-color: var(--line-strong); color: var(--text); }
.btn-ink { background: var(--ink); color: #fff; }
.btn-ink:hover { background: #262938; color: #fff; }

/* ---------- fill with Claude ---------- */
.handoff .q-meta { margin: 0 0 10px; }
.handoff .q-label { display: block; margin: 0 0 12px; }
.textarea.message { min-height: 0; resize: none; field-sizing: content; font: 400 14px/1.6 var(--mono); color: var(--text-2); }
.copy-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; margin-top: 14px; }
.copy-row + .fine { margin-top: 12px; }
#copy-status:empty { display: none; }

/* ---------- notices ---------- */
.notice {
  display: flex; gap: 14px; align-items: flex-start;
  padding: 16px 18px; margin-bottom: 20px;
  border-radius: var(--radius);
  background: var(--accent-soft);
  border: 1px solid var(--accent-ring);
  font-size: 15px; color: var(--text);
}
.notice svg { flex: none; width: 20px; height: 20px; margin-top: 2px; color: var(--primary); }
.notice p { margin: 0; }
.notice p + p { margin-top: 4px; color: var(--text-2); font-size: 14px; }
.notice.warn { background: var(--surface-2); border-color: var(--line); }
.notice.warn svg { color: var(--text-2); }
.notice.error { background: var(--danger-soft); border-color: var(--danger); }
.notice.error svg { color: var(--danger); }
.notice ul { margin: 6px 0 0; padding-left: 18px; }
.host {
  display: inline-block; padding: 1px 7px; border-radius: 6px;
  background: var(--surface); border: 1px solid var(--line);
  font: 500 13px/1.5 var(--mono);
}

/* ---------- review ---------- */
.answers { margin: 0; display: grid; gap: 0; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; }
.answer { padding: 18px 22px; border-top: 1px solid var(--line); }
.answer:first-child { border-top: 0; }
.answer dt { display: flex; gap: 10px; align-items: baseline; margin-bottom: 6px; font-size: 14px; color: var(--text-2); }
.answer dt .q-num { font: 500 11px/1 var(--mono); }
.answer dd { margin: 0; font-size: 16.5px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
.answer dd.empty { color: var(--text-3); font-style: italic; }
.answer.has-error { background: var(--danger-soft); }
.answer .q-error { margin-top: 6px; }
.tags { display: flex; flex-wrap: wrap; gap: 6px; }
.tag { padding: 4px 10px; border-radius: 999px; background: var(--accent-soft); color: var(--text); font-size: 14px; }

/* ---------- result pages ---------- */
.result { text-align: center; padding-top: 40px; }
.result .badge {
  display: grid; place-items: center;
  width: 64px; height: 64px; margin: 0 auto 28px;
  border-radius: 20px;
  background: var(--mint); color: var(--ink);
  box-shadow: 0 0 0 8px var(--mint-soft);
}
.result .badge.neutral { background: var(--surface-2); color: var(--text-2); box-shadow: 0 0 0 8px var(--surface-2); opacity: .9; }
.result .badge svg { width: 28px; height: 28px; }
.result .lede { margin-left: auto; margin-right: auto; max-width: 440px; }
.result .actions { justify-content: center; border-top: 0; }

/* ---------- home ---------- */
.hero { padding: 40px 0 56px; max-width: 760px; }
.hero .display { font-size: clamp(44px, 7.6vw, 80px); }
.hero .lede { font-size: 19px; max-width: 600px; }
.hero .actions { border-top: 0; padding-top: 0; }
.steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin: 8px 0 72px; }
.step { padding: 24px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); }
.step .q-num { display: block; margin-bottom: 18px; font: 500 12px/1 var(--mono); }
.step p { margin: 0; font-size: 15px; color: var(--text-2); }
.split { display: grid; grid-template-columns: 1fr 1.25fr; gap: 40px; align-items: start; margin-bottom: 72px; }
.split p { color: var(--text-2); }
.links-demo { display: grid; gap: 10px; }
.link-card { display: flex; align-items: center; gap: 14px; padding: 16px 18px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); }
.link-card .ic { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px; flex: none; }
.link-card .ic.a { background: var(--accent-soft); color: var(--primary); }
.link-card .ic.m { background: var(--mint-soft); color: var(--mint-ink); }
.link-card .ic svg { width: 18px; height: 18px; }
.link-card strong { display: block; font-size: 15px; font-weight: 600; }
.link-card span { font: 400 13px/1.4 var(--mono); color: var(--text-3); }
pre.code {
  margin: 0; padding: 20px 22px; overflow-x: auto;
  background: var(--ink); color: #E6E6EE;
  border-radius: var(--radius);
  font: 400 13.5px/1.7 var(--mono);
}
pre.code .k { color: var(--mint); }
pre.code .s { color: #B9B3FF; }
pre.code .c { color: var(--muted); }
.principles { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0; border-top: 1px solid var(--line); margin-bottom: 40px; }
.principle { padding: 22px 24px 22px 0; border-bottom: 1px solid var(--line); }
.principle p { margin: 0; color: var(--text-2); font-size: 15px; }

@media (max-width: 760px) {
  .steps, .split, .principles { grid-template-columns: 1fr; }
  .split { gap: 20px; }
  .shell { padding-top: 32px; }
  .q { padding: 18px 16px 16px; }
  .answer { padding: 16px; }
  .actions .btn { flex: 1 1 100%; }
}

@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; }
}
`;
