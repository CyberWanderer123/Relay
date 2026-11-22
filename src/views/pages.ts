import type { Field } from "../schema.js";
import { LIMITS, parseDate, RANGES, visibleFieldIds } from "../schema.js";
import type { FormLinks, StoredForm } from "../service.js";
import { h, type Safe } from "./html.js";
import { icons, layout } from "./layout.js";
import { PAGE_JS_VERSION } from "./scripts.js";
import { themeCss, themeVersion } from "./theme.js";
import { ASSISTANTS, type Assistant } from "../assistants.js";
import { renderChatPrompt } from "../clean.js";

export type Values = Record<string, string[]>;
export type Errors = Record<string, string>;

const num = (i: number) => String(i + 1).padStart(2, "0");

/** A form's own look (theme stylesheet, logo) and whether it is shown inside an iframe. */
export function look(form: StoredForm, embed = false) {
  const css = themeCss(form.settings);
  const logo = form.settings.brand?.logo_url;
  return {
    brand: {
      ...(css && { themeHref: `/f/${form.id}/theme.css?v=${themeVersion(css)}` }),
      ...(logo && { logoUrl: logo, logoAlt: form.title }),
    },
    embed,
  };
}
const embedQs = (embed?: boolean) => (embed ? "?embed=1" : "");
const newTab = (embed?: boolean) => (embed ? h` target="_blank"` : "");

function minutes(fields: Field[]): string {
  const secs = fields.reduce((t, f) => t + (f.type === "long_text" ? 45 : 12), 0);
  return `~${Math.max(1, Math.round(secs / 60))} min`;
}

function meta(f: Field, i: number, hint?: string): Safe {
  return h`<span class="q-meta"><span class="q-num">${num(i)}</span>${
    f.required ? h`<span class="q-req">Required</span>` : h`<span class="q-opt">Optional</span>`
  }${hint ? h`<span class="q-hint">${hint}</span>` : ""}</span>`;
}

function errorLine(f: Field, err?: string): Safe | string {
  return err ? h`<p class="q-error" id="err-${f.id}" role="alert">${err}</p>` : "";
}

/** data-show-* attributes for the page script, and the "Only if…" note shown without it. */
function condition(f: Field, fields: Field[]): { attrs: Safe | string; note: Safe | string } {
  if (!f.show_if) return { attrs: "", note: "" };
  const target = fields.find((t) => t.id === f.show_if!.field);
  const attrs = h` data-show-field="${f.show_if.field}" data-show-any="${JSON.stringify(f.show_if.any_of)}"`;
  const note = h`<p class="q-cond">${icons.branch}Only if “${target?.label ?? f.show_if.field}” is ${f.show_if.any_of.join(" or ")}</p>`;
  return { attrs, note };
}

function fieldBlock(f: Field, i: number, values: string[], err: string | undefined, fields: Field[]): Safe {
  const cls = `q${err ? " has-error" : ""}`;
  const cond = condition(f, fields);
  const v = values[0] ?? "";
  const describedBy = err ? `err-${f.id}` : "";
  const required = f.required ? "required" : "";

  if (f.type === "single_choice" || f.type === "multi_choice") {
    const multi = f.type === "multi_choice";
    return h`<fieldset class="${cls}" id="q-${f.id}"${cond.attrs}${describedBy ? h` aria-describedby="${describedBy}"` : ""}>
  ${cond.note}
  <legend class="q-head">${meta(f, i, multi ? "Choose any" : "Choose one")}<span class="q-label">${f.label}</span></legend>
  <div class="options">
    ${(f.options ?? []).map(
      (o) => h`<label class="opt"><input type="${multi ? "checkbox" : "radio"}" name="${f.id}" value="${o}"${
        values.includes(o) ? h` checked` : ""
      }${!multi && f.required ? h` required` : ""}><span class="opt-mark ${multi ? "check" : "radio"}"></span><span class="opt-text">${o}</span></label>`,
    )}
  </div>
  ${errorLine(f, err)}
</fieldset>`;
  }

  if (f.type === "rating" || f.type === "scale") {
    const { min, max } = RANGES[f.type];
    const steps = Array.from({ length: max - min + 1 }, (_, k) => String(min + k));
    const rating = f.type === "rating";
    return h`<fieldset class="${cls}" id="q-${f.id}"${cond.attrs}${describedBy ? h` aria-describedby="${describedBy}"` : ""}>
  ${cond.note}
  <legend class="q-head">${meta(f, i, rating ? "1–5 stars" : `${min}–${max}`)}<span class="q-label">${f.label}</span></legend>
  <div class="steps-row ${rating ? "is-rating" : "is-scale"}">
    ${steps.map(
      (s) => h`<label class="step-pick"><input type="radio" name="${f.id}" value="${s}"${v === s ? h` checked` : ""}${
        f.required ? h` required` : ""
      } aria-label="${rating ? `${s} star${s === "1" ? "" : "s"}` : s}"><span>${rating ? h`${icons.star}<b>${s}</b>` : s}</span></label>`,
    )}
  </div>
  ${f.type === "scale" && (f.low_label || f.high_label) ? h`<div class="scale-ends"><span>${f.low_label ?? ""}</span><span>${f.high_label ?? ""}</span></div>` : ""}
  ${errorLine(f, err)}
</fieldset>`;
  }

  const head = h`<label class="q-head" for="in-${f.id}">${meta(f, i)}<span class="q-label">${f.label}</span></label>`;
  const aria = describedBy ? h` aria-describedby="${describedBy}" aria-invalid="true"` : "";
  const max = LIMITS.answer[f.type];

  let control: Safe;
  if (f.type === "long_text") {
    control = h`<textarea class="textarea" id="in-${f.id}" name="${f.id}" maxlength="${max}" rows="5" ${required}${aria}>${v}</textarea>`;
  } else if (f.type === "email") {
    control = h`<input class="input" type="email" id="in-${f.id}" name="${f.id}" value="${v}" maxlength="${max}" autocomplete="email" inputmode="email" placeholder="name@example.com" ${required}${aria}>`;
  } else if (f.type === "number") {
    control = h`<input class="input" type="text" id="in-${f.id}" name="${f.id}" value="${v}" maxlength="${max}" inputmode="decimal" autocomplete="off" ${required}${aria}>`;
  } else if (f.type === "date") {
    control = h`<input class="input" type="date" id="in-${f.id}" name="${f.id}" value="${v}" ${required}${aria}>`;
  } else if (f.type === "url") {
    // type=text, not type=url: browsers reject "example.com" without https://, which Relay accepts.
    control = h`<input class="input" type="text" id="in-${f.id}" name="${f.id}" value="${v}" maxlength="${max}" inputmode="url" autocomplete="url" autocapitalize="off" spellcheck="false" placeholder="example.com" ${required}${aria}>`;
  } else if (f.type === "phone") {
    control = h`<input class="input" type="tel" id="in-${f.id}" name="${f.id}" value="${v}" maxlength="${max}" autocomplete="tel" placeholder="+1 555 010 0000" ${required}${aria}>`;
  } else {
    control = h`<input class="input" type="text" id="in-${f.id}" name="${f.id}" value="${v}" maxlength="${max}" ${required}${aria}>`;
  }
  return h`<div class="${cls}" id="q-${f.id}"${cond.attrs}>${cond.note}${head}${control}${errorLine(f, err)}</div>`;
}

const honeypot = h`<div class="hp" aria-hidden="true"><label>Leave this empty<input type="text" name="_hp" tabindex="-1" autocomplete="off"></label></div>`;

/* ------------------------------------------------------------------ */

export function formPage(o: {
  form: StoredForm;
  links: FormLinks;
  host: string;
  values: Values;
  errors: Errors;
  /** Remaining spots when the form has a response limit. */
  spotsLeft?: number | null;
  /** Shown inside an iframe on another site. */
  embed?: boolean;
}): string {
  const { form, errors } = o;
  const limits = [
    form.settings.closes_at && h`<span class="chip">${icons.clock}Closes ${formatInstant(form.settings.closes_at)}</span>`,
    typeof o.spotsLeft === "number" && h`<span class="chip">${o.spotsLeft} spot${o.spotsLeft === 1 ? "" : "s"} left</span>`,
  ].filter(Boolean);
  const fieldErrors = Object.keys(errors).filter((k) => k !== "_form").length;
  const body = h`
<section class="form-head">
  <p class="eyebrow"><span class="dot"></span>Form · ${form.fields.length} question${form.fields.length === 1 ? "" : "s"} · ${minutes(form.fields)}</p>
  <h1 class="display">${form.title}</h1>
  ${form.description ? h`<p class="lede">${form.description}</p>` : ""}
  ${limits.length ? h`<div class="meta-row">${limits}</div>` : ""}
  <div class="assist" role="group" aria-labelledby="assist-label">
    <p class="assist-label" id="assist-label">${icons.chat}<span>Prefer a chat? Your assistant can draft answers from what it knows about you.</span></p>
    <div class="assist-row">
      ${Object.entries(ASSISTANTS).map(([key, a]) => h`<a class="chip" href="/c/${form.id}/${key}" rel="noreferrer"${newTab(o.embed)}>${a.name}</a>`)}
      <details class="assist-other">
        <summary class="chip">Other assistant</summary>
        <label class="fine" for="relay-message">Paste this into any assistant:</label>
        <textarea class="textarea message" id="relay-message" readonly rows="6" spellcheck="false">${renderChatPrompt(form, o.links)}</textarea>
        <div class="copy-row">
          <button class="btn btn-ghost" type="button" data-copy hidden>Copy message</button>
          <p class="fine" id="copy-status" role="status" aria-live="polite"></p>
        </div>
      </details>
    </div>
  </div>
</section>
${
  fieldErrors || errors._form
    ? h`<div class="notice error" role="alert">${icons.alert}<div><p><strong>Some answers need another look.</strong></p>${
        errors._form ? h`<p>${errors._form}</p>` : h`<p>${fieldErrors} question${fieldErrors === 1 ? "" : "s"} below ${fieldErrors === 1 ? "is" : "are"} marked.</p>`
      }</div></div>`
    : ""
}
<form method="post" action="/f/${form.id}/submit${embedQs(o.embed)}" accept-charset="utf-8" data-relay-form>
  <div class="questions">
    ${form.fields.map((f, i) => fieldBlock(f, i, o.values[f.id] ?? [], errors[f.id], form.fields))}
  </div>
  ${honeypot}
  <div class="actions">
    <button class="btn btn-primary" type="submit">Submit response ${icons.arrow}</button>
    <p class="fine">Answers are sent to <span class="mono">${o.host}</span>. Nothing is shared until you submit.</p>
  </div>
</form>
<p class="fine agent-note">For AI assistants: a plain-text version of this form, with instructions, is at <a href="${o.links.clean}">${o.links.clean}</a>.</p>`;
  return layout({
    title: form.title,
    body,
    host: o.host,
    noindex: true,
    alternate: o.links.clean,
    scripts: [`/assets/relay.js?v=${PAGE_JS_VERSION}`],
    ...look(form, o.embed),
  });
}

/* ------------------------------------------------------------------ */

function displayValue(f: Field, values: string[]): Safe {
  if (!values.length) return h`<dd class="empty">No answer</dd>`;
  if (f.type === "multi_choice") return h`<dd><span class="tags">${values.map((v) => h`<span class="tag">${v}</span>`)}</span></dd>`;
  const v = values[0]!;
  if (f.type === "rating" && /^[1-5]$/.test(v)) {
    const n = Number(v);
    return h`<dd><span class="stars" aria-label="${v} of 5 stars">${Array.from({ length: 5 }, (_, k) => h`<span class="${k < n ? "on" : ""}">${icons.star}</span>`)}</span> ${v} / 5</dd>`;
  }
  if (f.type === "scale") return h`<dd>${v} / 10</dd>`;
  if (f.type === "date") {
    const d = parseDate(v);
    if (d) return h`<dd>${new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}</dd>`;
  }
  return h`<dd>${v}</dd>`;
}

export function reviewPage(o: {
  form: StoredForm;
  host: string;
  values: Values;
  errors: Errors;
  ignored: string[];
  editHref: string;
}): string {
  const { form, errors } = o;
  const valid = Object.keys(errors).length === 0;
  // Questions whose condition isn't met by these answers are left out of the review.
  const given = Object.fromEntries(Object.entries(o.values).map(([k, v]) => [k, v.length > 1 ? v : (v[0] ?? "")]).filter(([, v]) => v !== ""));
  const visible = visibleFieldIds(form.fields, given);
  const shown = form.fields.filter((f) => visible.has(f.id));
  const body = h`
<section class="form-head">
  <p class="eyebrow"><span class="dot"></span>Review before submitting</p>
  <h1 class="display">${form.title}</h1>
</section>

<div class="notice">${icons.lock}<div>
  <p><strong>Nothing has been saved yet.</strong> These answers were prepared for you in a chat.</p>
  <p>Check each one. Pressing Submit sends them to <span class="host">${o.host}</span>.</p>
</div></div>

${
  o.ignored.length
    ? h`<div class="notice warn">${icons.info}<div><p>The link included ${o.ignored.length === 1 ? "a value" : "values"} for ${o.ignored.length === 1 ? "a question" : "questions"} this form doesn't have. ${o.ignored.length === 1 ? "It" : "They"} will be left out.</p><p class="mono">${o.ignored.slice(0, 8).join(", ")}</p></div></div>`
    : ""
}
${
  valid
    ? ""
    : h`<div class="notice error" role="alert">${icons.alert}<div><p><strong>Some answers can't be submitted as they are.</strong></p><p>Open the web form to fix them — your answers will be filled in.</p></div></div>`
}

<dl class="answers">
  ${shown.map(
    (f) => h`<div class="answer${errors[f.id] ? " has-error" : ""}">
    <dt><span class="q-num">${num(form.fields.indexOf(f))}</span><span>${f.label}</span></dt>
    ${displayValue(f, o.values[f.id] ?? [])}
    ${errors[f.id] ? h`<p class="q-error">${errors[f.id]}</p>` : ""}
  </div>`,
  )}
</dl>

${
  valid
    ? h`<form method="post" action="/f/${form.id}/submit" accept-charset="utf-8">
  ${shown.flatMap((f) => (o.values[f.id] ?? []).map((v) => h`<input type="hidden" name="${f.id}" value="${v}">`))}
  ${honeypot}
  <div class="actions">
    <button class="btn btn-primary" type="submit">${icons.check} Submit these answers</button>
    <a class="btn btn-ghost" href="${o.editHref}" rel="noreferrer">${icons.edit} Edit in the web form</a>
  </div>
</form>`
    : h`<div class="actions"><a class="btn btn-primary" href="${o.editHref}" rel="noreferrer">${icons.edit} Fix in the web form</a></div>`
}`;
  return layout({ title: `Review · ${form.title}`, body, host: o.host, noindex: true, ...look(form) });
}

/* ------------------------------------------------------------------ */

function resultPage(o: {
  host: string;
  title: string;
  eyebrow: string;
  heading: Safe | string;
  lede: Safe | string;
  icon: Safe;
  tone?: "mint" | "neutral";
  actions?: Safe;
  look?: ReturnType<typeof look>;
}): string {
  const body = h`<section class="result">
  <div class="badge${o.tone === "neutral" ? " neutral" : ""}">${o.icon}</div>
  <p class="eyebrow"><span class="dot${o.tone === "neutral" ? "" : " mint"}"></span>${o.eyebrow}</p>
  <h1 class="display">${o.heading}</h1>
  <p class="lede">${o.lede}</p>
  ${o.actions ?? ""}
</section>`;
  return layout({ title: o.title, body, host: o.host, noindex: true, ...o.look });
}

/** /c/:id/:assistant fallback for forms too long for a prefilled link: copy the message, open the assistant, paste. */
export function assistantPage(o: { host: string; form: StoredForm; assistant: Assistant; message: string; fillUrl: string }): string {
  const n = o.form.fields.length;
  const name = o.assistant.name;
  const body = h`
<section class="form-head">
  <p class="eyebrow"><span class="dot mint"></span>Fill it with ${name} · ${n} question${n === 1 ? "" : "s"}</p>
  <h1 class="display">${o.form.title}</h1>
  <p class="lede">${name} asks you the questions in a chat, then gives you a link to check your answers. Nothing is sent until you press Submit on that page.</p>
</section>
<div class="questions handoff">
  <section class="q">
    <p class="q-meta"><span class="q-num">01</span><span class="q-hint">Copy this message</span></p>
    <label class="q-label" for="relay-message">Your message to ${name}</label>
    <textarea class="textarea message" id="relay-message" readonly rows="4" spellcheck="false">${o.message}</textarea>
    <div class="copy-row">
      <button class="btn btn-ghost" type="button" data-copy hidden>Copy message</button>
      <p class="fine" id="copy-status" role="status" aria-live="polite"></p>
    </div>
  </section>
  <section class="q">
    <p class="q-meta"><span class="q-num">02</span><span class="q-hint">Open ${name} and paste it</span></p>
    <p class="q-label">Start a new chat, paste the message and send it.</p>
    <div class="copy-row">
      <a class="btn btn-primary" href="${o.assistant.home}" target="_blank" rel="noopener noreferrer" data-copy>${icons.chat}Copy and open ${name}</a>
    </div>
  </section>
</div>
<div class="actions">
  <p class="fine">This form is too long to hand over in one link, so it goes by copy and paste. Prefer a normal form? <a href="${o.fillUrl}">Fill it in here</a>.</p>
</div>`;
  return layout({
    title: `Fill with ${name} · ${o.form.title}`,
    body,
    host: o.host,
    noindex: true,
    ...look(o.form),
    scripts: [`/assets/relay.js?v=${PAGE_JS_VERSION}`],
  });
}

export function thanksPage(host: string, form: StoredForm, embed = false): string {
  const ty = form.settings.thank_you;
  return resultPage({
    look: look(form, embed),
    host,
    title: `Thank you · ${form.title}`,
    eyebrow: "Response received",
    heading: h`Thank <em>you.</em>`,
    lede: ty?.message ?? h`Your answers to “${form.title}” were saved. You can close this tab.`,
    icon: icons.check,
    actions:
      ty?.button_url && ty.button_label
        ? h`<div class="actions"><a class="btn btn-primary" href="${ty.button_url}" rel="noopener noreferrer"${newTab(embed)}>${ty.button_label} ${icons.arrow}</a><p class="fine">Opens <span class="mono">${hostOf(ty.button_url)}</span></p></div>`
        : undefined,
  });
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** "21 November 2026, 18:00 UTC" */
export function formatInstant(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
  return `${date}, ${time} UTC`;
}

export const closedPage = (host: string, form: StoredForm, embed = false) =>
  resultPage({
    look: look(form, embed),
    host,
    title: `Closed · ${form.title}`,
    eyebrow: form.closed_reason === "full" ? "Form full" : form.closed_reason === "paused" ? "Paused" : "Form closed",
    heading: form.closed_reason === "full" ? "All spots are taken." : form.closed_reason === "paused" ? "Not taking responses right now." : "This form is closed.",
    lede:
      form.closed_reason === "deadline" && form.settings.closes_at
        ? h`“${form.title}” stopped accepting responses on ${formatInstant(form.settings.closes_at)}.`
        : form.closed_reason === "full"
          ? h`“${form.title}” has reached its limit of ${String(form.settings.max_responses)} responses.`
          : form.closed_reason === "paused"
            ? h`“${form.title}” has paused for now. Please try again later, or let the person who sent it know.`
          : h`“${form.title}” is no longer accepting responses.`,
    icon: icons.lock,
    tone: "neutral",
  });

export const notFoundPage = (host: string) =>
  resultPage({
    host,
    title: "Form not found · Relay",
    eyebrow: "404",
    heading: "We couldn't find that form.",
    lede: "Check the link — it may be incomplete, or the form may have been removed.",
    icon: icons.info,
    tone: "neutral",
  });

export const errorPage = (host: string, heading: string, lede: string) =>
  resultPage({ host, title: `${heading} · Relay`, eyebrow: "Something went wrong", heading, lede, icon: icons.alert, tone: "neutral" });

export const rateLimitedPage = (host: string) =>
  resultPage({
    host,
    title: "Slow down · Relay",
    eyebrow: "Too many submissions",
    heading: "Give it a minute.",
    lede: "We received several submissions from your connection in a short time. Please try again shortly.",
    icon: icons.info,
    tone: "neutral",
  });

/* ------------------------------------------------------------------ */

/** Upstream repository. Forks can change this to point at their own copy. */
export const REPO_URL = "https://github.com/anurag-ships/Relay";
/** Vercel's clone-and-deploy link: copies the repo and asks for the three settings Relay needs. */
export const DEPLOY_URL =
  "https://vercel.com/new/clone?repository-url=" +
  encodeURIComponent(REPO_URL) +
  "&project-name=relay&repository-name=relay&env=RELAY_OWNER_KEY,TURSO_DATABASE_URL,TURSO_AUTH_TOKEN" +
  "&envDescription=" + encodeURIComponent("Your owner key (any long random secret) and your Turso database URL and token") +
  "&envLink=" + encodeURIComponent(REPO_URL + "#deploy-to-vercel--turso-recommended");

export function homePage(o: {
  host: string;
  baseUrl: string;
  ownerConfigured: boolean;
  suggestedKey: string;
  /** Hosted Relay: anyone can use it with a free account. */
  hosted?: { monthlyResponses: number; contactEmail?: string };
}): string {
  const body = h`
<section class="hero hero-grid">
  <div>
    <p class="eyebrow"><span class="dot"></span>Agent-first form builder · open source</p>
    <h1 class="display">Ask for a form.<br><em>Ask</em> what people said.</h1>
    <p class="lede">Relay is the form builder you run from your AI assistant. Describe what you need, share one link, then ask how it's going. Relay builds the form, runs it on its own, and turns the answers into answers.</p>
    <div class="actions">
      <a class="btn btn-ink" href="#start">Get started ${icons.arrow}</a>
      <a class="btn btn-ghost" href="#understand">See the analysis</a>
    </div>
  </div>
  <div class="chat-mock" aria-label="Example conversation with an assistant using Relay">
    <div class="bubble me">Make a sign-up for Saturday's workshop. 30 seats, close Friday 6pm, then send people to my booking link.</div>
    <div class="bubble ai"><span class="tool">${icons.form}create_form</span>Done. Here's the message to send:<span class="share">Hi! Grab a seat for Saturday's workshop.<br>Form: ${o.host}/f/…</span></div>
    <div class="bubble me">How's it going?</div>
    <div class="bubble ai"><span class="tool">${icons.chat}summarize_responses</span><b>23 signed up, 7 seats left.</b> 14 beginners, 9 experienced. 5 staying for lunch, 2 vegetarian.</div>
  </div>
</section>

<section class="pillars" aria-label="What Relay does">
  <div class="pillar"><span class="q-num">01 — Ask</span><h3>Build by describing it</h3><p>Your assistant drafts the questions, picks the types and adds conditions. You get a message ready for WhatsApp or email.</p></div>
  <div class="pillar"><span class="q-num">02 — Run</span><h3>It runs itself</h3><p>Seats, deadlines and next steps are set in one sentence. The form counts down, closes on time and says why.</p></div>
  <div class="pillar"><span class="q-num">03 — Understand</span><h3>Ask what people said</h3><p>Exact counts, averages and NPS, computed by Relay. Your assistant explains them, compares them and acts on them.</p></div>
</section>

<section class="split feature" id="ask">
  <div>
    <p class="eyebrow"><span class="dot"></span>Ask</p>
    <h2>A form from one sentence.</h2>
    <p>Say who you're asking and why. Relay turns it into a real form: choices, ratings, 0–10 scales, dates, links, phone numbers, and questions that appear only when they apply.</p>
    <ul class="ticks">
      <li>${icons.check}<span><b>Conditional questions.</b> "Ask about lunch only if they're staying."</span></li>
      <li>${icons.check}<span><b>Safe edits.</b> Reword or add questions any time. Relay refuses changes that would make existing answers misleading, and says why.</span></li>
      <li>${icons.check}<span><b>Your look.</b> Your colour, adjusted for readability, and your logo. Embed it only on the sites you choose.</span></li>
    </ul>
  </div>
  <div class="mock-card" aria-hidden="true">
    <p class="mock-eyebrow">Form · 5 questions · ~2 min</p>
    <p class="mock-title">Saturday workshop</p>
    <div class="mock-q"><span>Experience level</span><span class="mock-pills"><i>Beginner</i><i class="on">Experienced</i></span></div>
    <div class="mock-q"><span>Staying for lunch?</span><span class="mock-pills"><i class="on">Yes</i><i>No</i></span></div>
    <div class="mock-q cond"><span>${icons.branch}Dietary needs <em>only if staying for lunch</em></span><span class="mock-line"></span></div>
    <div class="mock-q"><span>How likely are you to recommend us?</span><span class="mock-scale">${Array.from({ length: 11 }, (_, i) => h`<i${i === 9 ? h` class="on"` : ""}>${String(i)}</i>`)}</span></div>
  </div>
</section>

<section class="split feature" id="run">
  <div class="mock-card run" aria-hidden="true">
    <div class="mock-chips"><span class="chip">${icons.clock}Closes Friday, 18:00</span><span class="chip">7 spots left</span></div>
    <div class="seat-bar"><span class="seat-fill"></span><b>23 / 30</b></div>
    <div class="mock-thanks">
      <p class="mock-title">Thank <em>you.</em></p>
      <p>You're in! Pick a slot for the prep call.</p>
      <span class="btn btn-primary btn-sm">Book your prep call ${icons.arrow}</span>
    </div>
  </div>
  <div>
    <p class="eyebrow"><span class="dot mint"></span>Run</p>
    <h2>Set it once. It runs itself.</h2>
    <p>Tell your assistant the rules in plain words. Relay keeps them for you.</p>
    <ul class="ticks">
      <li>${icons.check}<span><b>Seats, first come first served.</b> "100 seats." The form shows what's left, closes at 100, and the last person still gets their confirmation.</span></li>
      <li>${icons.check}<span><b>Deadlines.</b> "Close Friday 6pm." It closes on time and tells late visitors why.</span></li>
      <li>${icons.check}<span><b>A next step.</b> A custom thank-you message and button, such as "Book your call".</span></li>
      <li>${icons.check}<span><b>A webhook for every response.</b> Signed, for Slack, Zapier, n8n or your own code.</span></li>
    </ul>
  </div>
</section>

<section class="understand" id="understand">
  <div class="understand-head">
    <p class="eyebrow"><span class="dot"></span>Understand</p>
    <h2>The analysis lives in your chat.</h2>
    <p>Relay computes the numbers exactly, so your assistant never has to guess them. Then you ask questions the way you'd ask a colleague.</p>
  </div>
  <div class="understand-grid">
    <div class="ask-card">
      <p class="ask">"Anything new?"</p>
      <p class="answer-text"><b>3 new responses</b> since you last checked. Relay remembers what you've already seen, form by form.</p>
    </div>
    <div class="ask-card">
      <p class="ask">"How did people rate it?"</p>
      <div class="bars" aria-hidden="true">
        <div><span>Great</span><i class="w78"></i><b>18</b></div>
        <div><span>Okay</span><i class="w17"></i><b>4</b></div>
        <div><span>Poor</span><i class="w4"></i><b>1</b></div>
      </div>
      <p class="answer-text">Exact counts, averages and medians, and <b>NPS +42</b> for 0–10 scales.</p>
    </div>
    <div class="ask-card">
      <p class="ask">"Who's a strong lead? Draft them a reply."</p>
      <p class="answer-text">Your assistant reads the responses, ranks them and drafts the follow-ups. You send them.</p>
    </div>
    <div class="ask-card">
      <p class="ask">"Export it."</p>
      <p class="answer-text">A CSV link for Excel or Sheets that works for 15 minutes and carries no key.</p>
    </div>
  </div>
</section>

<section class="principles" aria-label="Safe and open">
  <div class="principle"><h3>Safe to hand to an agent</h3><p>Answers reach your assistant marked as data, so a response that says "ignore your instructions" can't steer it.</p></div>
  <div class="principle"><h3>A person always confirms</h3><p>Nothing is submitted for anyone. Opening a link never saves anything.</p></div>
  <div class="principle"><h3>Zero AI cost</h3><p>Relay never calls a model. Your own assistant does the thinking, on your own plan.</p></div>
  <div class="principle"><h3>Open source, yours to host</h3><p>Run it free on Vercel and Turso, keep your data, and export it whenever you like.</p></div>
</section>

<section class="start" id="start">
  <div class="understand-head">
    <p class="eyebrow"><span class="dot"></span>Get started</p>
    ${
      o.hosted
        ? h`<h2>Start in a minute.</h2>
    <p>Use Relay right here with a free account, or run your own copy with no limits. Either way, you connect your assistant and ask for a form.</p>`
        : h`<h2>Run your own Relay in a few minutes.</h2>
    <p>Each Relay belongs to one person: its owner. You deploy your own copy, keep its owner key, and connect your assistant to it. It's free to run.</p>`
    }
  </div>
  ${
    o.hosted
      ? h`<div class="hosted-start">
    <div class="setup-step card featured">
      <span class="q-num">Free · no setup</span>
      <h3>Use Relay right here</h3>
      <p>Add this address as a connector in Claude (<b>Customize → Connectors → Add custom connector</b>), ChatGPT or any MCP client:</p>
      <code class="keybox">${o.baseUrl}/mcp</code>
      <p>When Relay's Allow page opens, choose <b>Create a free account</b>. Free includes ${String(o.hosted.monthlyResponses)} responses a month across all your forms.</p>
      <p class="fine">Need more? Run your own Relay below: it's free and has no limits${o.hosted.contactEmail ? h`, or email <a href="mailto:${o.hosted.contactEmail}">${o.hosted.contactEmail}</a>` : ""}.</p>
    </div>
  </div>
  <h3 class="own-title">Or run your own Relay: free, no limits</h3>`
      : o.ownerConfigured
      ? h`<div class="notice">${icons.info}<div><p><strong>This Relay, <span class="host">${o.host}</span>, belongs to its owner.</strong></p><p>If it's yours, skip to step 3. If not, deploy your own copy: it takes a few minutes.</p></div></div>`
      : h`<div class="notice warn">${icons.alert}<div><p><strong>This Relay isn't set up yet.</strong></p><p>Add an owner key (step 2) as <span class="mono">RELAY_OWNER_KEY</span> in this deployment's settings, then redeploy.</p></div></div>`
  }
  <ol class="setup">
    <li class="setup-step card">
      <span class="q-num">01 — Deploy</span>
      <h3>Deploy your own copy</h3>
      <p>One click copies Relay into your Vercel account and asks for three settings: your owner key (step 2) and a database. The data lives in a free <a href="https://turso.tech" rel="noopener noreferrer">Turso</a> database; create one and copy its URL and token.</p>
      <a class="btn btn-ink btn-sm" href="${DEPLOY_URL}" rel="noopener noreferrer">Deploy to Vercel ${icons.arrow}</a>
      <p class="fine">Prefer your own server? Use <a href="${REPO_URL}#self-hosting-with-docker" rel="noopener noreferrer">Docker</a>, or <a href="${REPO_URL}#quick-start-local" rel="noopener noreferrer">run it on your computer</a>.</p>
    </li>
    <li class="setup-step card">
      <span class="q-num">02 — Owner key</span>
      <h3>Pick a key for your new Relay</h3>
      <p>The owner key is the password to your Relay. You make it up when you deploy and set it as <span class="mono">RELAY_OWNER_KEY</span>; you'll paste it when you connect an assistant.</p>
      ${
        o.ownerConfigured
          ? h`<details class="keygen"><summary>Setting up a new Relay? Generate a key for it</summary>
        <code class="keybox">${o.suggestedKey}</code>
        <p class="fine">A random key for a <b>new</b> deployment, made just now and not stored anywhere. It is <b>not</b> the key of this Relay and won't work here.</p>
      </details>`
          : h`<p class="fine">Here is a random one, made just now and not stored anywhere:</p>
      <code class="keybox">${o.suggestedKey}</code>`
      }
      <p class="fine">Keep it secret: anyone who has it can manage your forms. Forgot it? It's in your host's settings (on Vercel: Settings → Environment Variables). Set a new one and redeploy to cut every connected assistant off.</p>
    </li>
    <li class="setup-step card">
      <span class="q-num">03 — Connect</span>
      <h3>Connect your assistant</h3>
      <p>In Claude, open <b>Customize → Connectors → Add custom connector</b> and enter your Relay's address followed by <span class="mono">/mcp</span>:</p>
      <code class="keybox">${o.ownerConfigured ? `${o.baseUrl}/mcp` : "https://your-relay.vercel.app/mcp"}</code>
      <p class="fine">Claude opens your Relay's <b>Allow</b> page. Paste your owner key and press Allow. Claude Desktop and other MCP clients that support connectors work the same way.</p>
    </li>
    <li class="setup-step card">
      <span class="q-num">04 — Try it</span>
      <h3>Ask for your first form</h3>
      <ul class="prompts">
        <li>"Make a sign-up for Saturday's workshop: 30 seats, close Friday 6pm."</li>
        <li>"Make a 3-question feedback form and give me the link."</li>
        <li>"Anything new on my forms?"</li>
      </ul>
      <p class="fine">Eight tools: create_form · update_form · list_forms · get_form · get_responses · summarize_responses · export_responses · close_form</p>
    </li>
  </ol>
</section>

<section class="devs" aria-label="For developers">
  <p class="eyebrow"><span class="dot mint"></span>For developers</p>
  <div class="dev-grid">
    <div><h3>REST API</h3><p>Everything the tools do, behind one owner key: <span class="mono">/api/forms</span>.</p></div>
    <div><h3>Webhooks</h3><p><span class="mono">response.created</span>, signed with HMAC-SHA256.</p></div>
    <div><h3>Agent-readable forms</h3><p>Every form has a plain-text version for assistants. The format is open: <a href="/spec">/spec</a>.</p></div>
  </div>
</section>`;
  return layout({
    title: "Relay — the agent-first form builder",
    description: "Build forms by asking your AI assistant, share one link, and ask what people said. Open source.",
    body,
    host: o.host,
    wide: true,
  });
}

/* ------------------------------------------------------------------ */
/* OAuth: the owner approves a connector                               */
/* ------------------------------------------------------------------ */

/** /oauth/authorize: "Allow <app> to use your Relay?" The owner key is the login (one owner per Relay). */
export function authorizePage(o: {
  host: string;
  clientName: string | null;
  redirectHost: string;
  params: Record<string, string | undefined>;
  error?: string;
  /** Hosted Relay: people sign in with their own account key, or create a free account. */
  hosted?: { monthlyResponses: number };
}): string {
  const app = o.clientName || "An app";
  const hidden = Object.entries(o.params).filter(([, v]) => v !== undefined) as [string, string][];
  const hiddenInputs = hidden.map(([k, v]) => h`<input type="hidden" name="${k}" value="${v}">`);
  const keyHelp = o.hosted
    ? h`<p class="fine">The account key you saved when you signed up. It isn't shared with ${app}; the app gets its own token instead.</p>`
    : h`<p class="fine">It's the <span class="mono">RELAY_OWNER_KEY</span> you set when you deployed <span class="mono">${o.host}</span>. It isn't shared with ${app}; the app gets its own token instead.</p>
    <p class="fine">Not your Relay? You need your own: <a href="/#start">set one up in a few minutes</a>.</p>`;
  const body = h`
<section class="form-head">
  <p class="eyebrow"><span class="dot"></span>Connect an assistant</p>
  <h1 class="display">Allow <em>${app}</em> to use ${o.hosted ? "Relay" : "your Relay"}?</h1>
  <p class="lede">It will be able to create, edit, read and close your forms, read responses and export them. It can't delete anything.</p>
</section>
${o.error ? h`<div class="notice error" role="alert">${icons.alert}<div><p><strong>${o.error}</strong></p></div></div>` : ""}
<div class="notice">${icons.lock}<div>
  <p>After you allow it, you'll go back to <span class="host">${o.redirectHost}</span>.</p>
  <p>Only continue if you started connecting this assistant yourself.</p>
</div></div>
${
  o.hosted
    ? h`<section class="signup q">
  <span class="q-label">New to Relay? Create a free account</span>
  <p class="fine">Free includes ${String(o.hosted.monthlyResponses)} responses a month across all your forms. You'll get an account key to save; it's how you sign in.</p>
  <form method="post" action="/oauth/signup" accept-charset="utf-8" class="signup-form">
    ${hiddenInputs}
    <input class="input" type="text" name="name" maxlength="80" autocomplete="name" placeholder="Your name (optional)">
    <input class="input" type="email" name="email" maxlength="254" autocomplete="email" placeholder="Email (for your account and important notices)" required>
    <button class="btn btn-ink" type="submit">Create a free account ${icons.arrow}</button>
  </form>
</section>
<p class="or">Already have an account?</p>`
    : ""
}
<form method="post" action="/oauth/authorize" accept-charset="utf-8">
  ${hiddenInputs}
  <div class="q">
    <label class="q-head" for="owner-key"><span class="q-label">${o.hosted ? "Your account key" : "Your owner key"}</span></label>
    <input class="input" type="password" id="owner-key" name="owner_key" autocomplete="current-password" spellcheck="false" required>
    ${keyHelp}
  </div>
  <div class="actions">
    <button class="btn btn-primary" type="submit" name="decision" value="allow">${icons.check} ${o.hosted ? "Sign in and allow" : "Allow"}</button>
    <button class="btn btn-ghost" type="submit" name="decision" value="deny" formnovalidate>Deny</button>
  </div>
</form>`;
  return layout({ title: `Allow ${app} · Relay`, body, host: o.host, noindex: true });
}

/** After sign-up: show the new account key once, then continue the connection with it. */
export function accountKeyPage(o: { host: string; clientName: string | null; key: string; params: Record<string, string | undefined> }): string {
  const app = o.clientName || "your assistant";
  const hidden = Object.entries(o.params).filter(([, v]) => v !== undefined) as [string, string][];
  const body = h`
<section class="form-head">
  <p class="eyebrow"><span class="dot mint"></span>Account created</p>
  <h1 class="display">Save your <em>account key.</em></h1>
  <p class="lede">This is the only time it's shown. You'll need it to connect another assistant, or to sign in again later.</p>
</section>
<div class="q">
  <span class="q-label">Your account key</span>
  <code class="keybox">${o.key}</code>
  <p class="fine">Keep it somewhere safe, like a password manager. Anyone who has it can manage your forms. If it's lost, it can't be recovered.</p>
</div>
<form method="post" action="/oauth/authorize" accept-charset="utf-8">
  ${hidden.map(([k, v]) => h`<input type="hidden" name="${k}" value="${v}">`)}
  <input type="hidden" name="owner_key" value="${o.key}">
  <label class="opt saved-check"><input type="checkbox" name="saved" value="yes" required><span class="opt-mark check"></span><span class="opt-text">I've saved my key</span></label>
  <div class="actions">
    <button class="btn btn-primary" type="submit" name="decision" value="allow">${icons.check} Continue to ${app}</button>
  </div>
</form>`;
  return layout({ title: "Save your key · Relay", body, host: o.host, noindex: true });
}

export const oauthErrorPage = (host: string, message: string) =>
  resultPage({
    host,
    title: "Can't connect · Relay",
    eyebrow: "Connection stopped",
    heading: "This connection can't continue.",
    lede: message,
    icon: icons.alert,
    tone: "neutral",
  });

/* ------------------------------------------------------------------ */
/* Legal pages: terms and privacy. Plain-language templates; the operator should review them. */
/* ------------------------------------------------------------------ */

function legalPage(o: { host: string; title: string; updated: string; intro: string; sections: [string, string[]][]; contactEmail?: string }): string {
  const body = h`
<section class="form-head">
  <p class="eyebrow"><span class="dot"></span>Last updated ${o.updated}</p>
  <h1 class="display">${o.title}</h1>
  <p class="lede">${o.intro}</p>
</section>
<div class="legal">
  ${o.sections.map(([heading, paras]) => h`<section><h2>${heading}</h2>${paras.map((p) => h`<p>${p}</p>`)}</section>`)}
  <section><h2>Contact</h2><p>${o.contactEmail ? h`Questions or requests: <a href="mailto:${o.contactEmail}">${o.contactEmail}</a>.` : "Contact the operator of this Relay."}</p></section>
</div>`;
  return layout({ title: `${o.title} · Relay`, body, host: o.host });
}

export const termsPage = (host: string, contactEmail?: string) =>
  legalPage({
    host,
    contactEmail,
    title: "Terms of use",
    updated: "21 November 2026",
    intro: `These terms cover your use of the Relay service at ${host}. By creating an account, connecting an assistant or creating a form, you agree to them. If you answer a form, the section for respondents applies to you.`,
    sections: [
      ["The service is provided as is", [
        "Relay is provided \"as is\" and \"as available\", without warranties of any kind, express or implied, including fitness for a particular purpose, accuracy, availability or that it will be free of errors.",
        "To the fullest extent the law allows, the operator of this Relay is not liable for any loss or damage arising from its use or unavailability, including lost data, lost responses, lost profits, downtime, security incidents, or anything done by assistants, integrations or other people with your forms or data.",
        "Free accounts may be limited, paused, changed or discontinued at any time.",
      ]],
      ["Your forms and the data you collect", [
        "You are responsible for every form you create and for the information you collect with it. You must have a lawful reason to collect it, tell respondents how you will use it, and handle it according to the laws that apply to you.",
        "Do not use Relay to collect passwords, payment card or bank details, government ID numbers, health information or other sensitive data, and do not use it for spam, phishing, harassment, deception or anything illegal.",
        "Answers people send through your forms are yours to manage. The operator does not review them and is not responsible for their content or for how you use them.",
      ]],
      ["Your account", [
        "Keep your account key secret. Anyone who has it can manage your forms. Lost keys cannot be recovered.",
        "Accounts and forms may be suspended or removed, without notice, if they break these terms or put the service or other people at risk.",
      ]],
      ["For respondents", [
        "When you answer a form, your answers go to the person or organisation that created it. They decide how your answers are used; the operator of this Relay does not. Contact the form's creator about your answers.",
      ]],
      ["Open source and self-hosted copies", [
        "Relay is open-source software. Copies that other people run on their own servers are operated by them, not by the operator of this Relay, and these terms do not cover them.",
      ]],
      ["Changes", [
        "These terms may change. The date at the top shows the latest version. Continuing to use Relay after a change means you accept it.",
      ]],
    ],
  });

export const privacyPage = (host: string, contactEmail?: string) =>
  legalPage({
    host,
    contactEmail,
    title: "Privacy policy",
    updated: "21 November 2026",
    intro: `This explains what the Relay service at ${host} stores and why. Relay keeps as little as it can, never calls an AI model with your data, never sells data and shows no ads.`,
    sections: [
      ["What is stored", [
        "Forms: their questions and settings. Responses: the answers people submit. Accounts (hosted mode): your email, an optional name, and a one-way hash of the account key (the key itself is never stored). The email is used to identify your account and to contact you about it.",
        "Connections: assistants you connect, and their sign-in codes and tokens, stored only as one-way hashes.",
        "Request logs record the method, page and result of each request, never query strings or answers. Network addresses are used briefly, in memory, to limit abuse, and are not saved with responses.",
      ]],
      ["Who controls response data", [
        "Form creators decide what to collect and how to use it, so they are responsible for their respondents' data. The operator of this Relay stores it on their behalf and does not use it for anything else.",
      ]],
      ["Services Relay relies on", [
        "Hosting runs on Vercel and data is stored in a Turso database. Pages load fonts from Google Fonts, and a form's logo loads from the address its creator chose, so those services can see your network address when you open a page.",
        "When you use an AI assistant with Relay, that assistant's own privacy terms apply to what you share with it.",
      ]],
      ["How long data is kept", [
        "Forms and responses are kept until the creator or the operator deletes them. Closing a form stops new responses but keeps existing ones.",
      ]],
      ["Your choices", [
        "Ask the operator to delete your account and forms, or a form's creator to delete your answers. Exports and deletions can also be done through your assistant or the API.",
      ]],
      ["Security", [
        "Data is sent over HTTPS, keys and tokens are stored only as hashes, and access to forms is limited to their owner. No system is perfectly secure; see the terms for the limits of responsibility.",
      ]],
    ],
  });
