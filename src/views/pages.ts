import type { Field } from "../schema.js";
import { LIMITS } from "../schema.js";
import type { FormLinks, StoredForm } from "../service.js";
import { h, type Safe } from "./html.js";
import { icons, layout } from "./layout.js";

export type Values = Record<string, string[]>;
export type Errors = Record<string, string>;

const num = (i: number) => String(i + 1).padStart(2, "0");

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

function fieldBlock(f: Field, i: number, values: string[], err?: string): Safe {
  const cls = `q${err ? " has-error" : ""}`;
  const v = values[0] ?? "";
  const describedBy = err ? `err-${f.id}` : "";
  const required = f.required ? "required" : "";

  if (f.type === "single_choice" || f.type === "multi_choice") {
    const multi = f.type === "multi_choice";
    return h`<fieldset class="${cls}" id="q-${f.id}"${describedBy ? h` aria-describedby="${describedBy}"` : ""}>
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
  } else {
    control = h`<input class="input" type="text" id="in-${f.id}" name="${f.id}" value="${v}" maxlength="${max}" ${required}${aria}>`;
  }
  return h`<div class="${cls}" id="q-${f.id}">${head}${control}${errorLine(f, err)}</div>`;
}

const honeypot = h`<div class="hp" aria-hidden="true"><label>Leave this empty<input type="text" name="_hp" tabindex="-1" autocomplete="off"></label></div>`;

/* ------------------------------------------------------------------ */

export function formPage(o: {
  form: StoredForm;
  links: FormLinks;
  host: string;
  values: Values;
  errors: Errors;
}): string {
  const { form, errors } = o;
  const fieldErrors = Object.keys(errors).filter((k) => k !== "_form").length;
  const body = h`
<section class="form-head">
  <p class="eyebrow"><span class="dot"></span>Form · ${form.fields.length} question${form.fields.length === 1 ? "" : "s"} · ${minutes(form.fields)}</p>
  <h1 class="display">${form.title}</h1>
  ${form.description ? h`<p class="lede">${form.description}</p>` : ""}
  <div class="meta-row">
    <a class="chip" href="/c/${form.id}" rel="noreferrer">${icons.chat}Prefer a chat? Fill it with Claude</a>
  </div>
</section>
${
  fieldErrors || errors._form
    ? h`<div class="notice error" role="alert">${icons.alert}<div><p><strong>Some answers need another look.</strong></p>${
        errors._form ? h`<p>${errors._form}</p>` : h`<p>${fieldErrors} question${fieldErrors === 1 ? "" : "s"} below ${fieldErrors === 1 ? "is" : "are"} marked.</p>`
      }</div></div>`
    : ""
}
<form method="post" action="/f/${form.id}/submit" accept-charset="utf-8">
  <div class="questions">
    ${form.fields.map((f, i) => fieldBlock(f, i, o.values[f.id] ?? [], errors[f.id]))}
  </div>
  ${honeypot}
  <div class="actions">
    <button class="btn btn-primary" type="submit">Submit response ${icons.arrow}</button>
    <p class="fine">Answers are sent to <span class="mono">${o.host}</span>. Nothing is shared until you submit.</p>
  </div>
</form>`;
  return layout({ title: form.title, body, host: o.host, noindex: true });
}

/* ------------------------------------------------------------------ */

function displayValue(f: Field, values: string[]): Safe {
  if (!values.length) return h`<dd class="empty">No answer</dd>`;
  if (f.type === "multi_choice") return h`<dd><span class="tags">${values.map((v) => h`<span class="tag">${v}</span>`)}</span></dd>`;
  return h`<dd>${values[0]}</dd>`;
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
  ${form.fields.map(
    (f, i) => h`<div class="answer${errors[f.id] ? " has-error" : ""}">
    <dt><span class="q-num">${num(i)}</span><span>${f.label}</span></dt>
    ${displayValue(f, o.values[f.id] ?? [])}
    ${errors[f.id] ? h`<p class="q-error">${errors[f.id]}</p>` : ""}
  </div>`,
  )}
</dl>

${
  valid
    ? h`<form method="post" action="/f/${form.id}/submit" accept-charset="utf-8">
  ${form.fields.flatMap((f) => (o.values[f.id] ?? []).map((v) => h`<input type="hidden" name="${f.id}" value="${v}">`))}
  ${honeypot}
  <div class="actions">
    <button class="btn btn-primary" type="submit">${icons.check} Submit these answers</button>
    <a class="btn btn-ghost" href="${o.editHref}" rel="noreferrer">${icons.edit} Edit in the web form</a>
  </div>
</form>`
    : h`<div class="actions"><a class="btn btn-primary" href="${o.editHref}" rel="noreferrer">${icons.edit} Fix in the web form</a></div>`
}`;
  return layout({ title: `Review · ${form.title}`, body, host: o.host, noindex: true });
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
}): string {
  const body = h`<section class="result">
  <div class="badge${o.tone === "neutral" ? " neutral" : ""}">${o.icon}</div>
  <p class="eyebrow"><span class="dot${o.tone === "neutral" ? "" : " mint"}"></span>${o.eyebrow}</p>
  <h1 class="display">${o.heading}</h1>
  <p class="lede">${o.lede}</p>
  ${o.actions ?? ""}
</section>`;
  return layout({ title: o.title, body, host: o.host, noindex: true });
}

export const thanksPage = (host: string, form: StoredForm) =>
  resultPage({
    host,
    title: `Thank you · ${form.title}`,
    eyebrow: "Response received",
    heading: h`Thank <em>you.</em>`,
    lede: h`Your answers to “${form.title}” were saved. You can close this tab.`,
    icon: icons.check,
  });

export const closedPage = (host: string, form: StoredForm) =>
  resultPage({
    host,
    title: `Closed · ${form.title}`,
    eyebrow: "Form closed",
    heading: "This form is closed.",
    lede: h`“${form.title}” is no longer accepting responses.`,
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

export function homePage(o: { host: string; baseUrl: string }): string {
  const body = h`
<section class="hero">
  <p class="eyebrow"><span class="dot"></span>Forms + MCP · self-hosted</p>
  <h1 class="display">Ask in a chat.<br><em>Collect</em> in a form.</h1>
  <p class="lede">Relay turns a request to Claude into a form with two links — one for the browser, one for any assistant. Answers come back to the same chat, counted and summarized. The server never calls a model.</p>
  <div class="actions">
    <a class="btn btn-ink" href="#connect">Connect Claude ${icons.arrow}</a>
    <a class="btn btn-ghost" href="#how">How it works</a>
  </div>
</section>

<section class="steps" id="how" aria-label="How it works">
  <div class="step"><span class="q-num">01 — Create</span><h3>Describe what to ask</h3><p>Tell Claude who you're asking and why. It drafts the questions and creates the form through Relay's tools.</p></div>
  <div class="step"><span class="q-num">02 — Share</span><h3>Paste one message</h3><p>You get a message ready for WhatsApp or email with two links. You send it — Relay never messages anyone.</p></div>
  <div class="step"><span class="q-num">03 — Read</span><h3>Ask for the results</h3><p>Counts, averages and sample answers are computed on the server, so your chat stays small and fast.</p></div>
</section>

<section class="split">
  <div>
    <p class="eyebrow"><span class="dot mint"></span>Respondents install nothing</p>
    <h2>Two links, one save.</h2>
    <p>People tap the form link and fill it in a browser. Or they tap the Claude link, answer in a chat, and confirm on a review page. Both paths end at the same validated submit.</p>
  </div>
  <div class="links-demo">
    <div class="link-card"><span class="ic a">${icons.form}</span><div><strong>Quick form</strong><span>${o.host}/f/…</span></div></div>
    <div class="link-card"><span class="ic m">${icons.chat}</span><div><strong>Fill it with Claude</strong><span>${o.host}/c/…</span></div></div>
    <div class="link-card"><span class="ic a">${icons.lock}</span><div><strong>Review, then submit</strong><span>Nothing saves until the person presses Submit</span></div></div>
  </div>
</section>

<section class="split" id="connect">
  <div>
    <p class="eyebrow"><span class="dot"></span>For creators</p>
    <h2>Connect Claude.</h2>
    <p>Add Relay as a remote connector at <span class="mono">${o.baseUrl}/mcp</span>, or run the local MCP program with your owner key in Claude Desktop.</p>
    <p class="fine">Six tools: create_form · list_forms · get_form · get_responses · summarize_responses · close_form</p>
  </div>
  <pre class="code"><span class="c">// claude_desktop_config.json</span>
{
  <span class="k">"mcpServers"</span>: {
    <span class="k">"relay"</span>: {
      <span class="k">"command"</span>: <span class="s">"npx"</span>,
      <span class="k">"args"</span>: [<span class="s">"tsx"</span>, <span class="s">"/path/to/relay/src/mcp/stdio.ts"</span>],
      <span class="k">"env"</span>: {
        <span class="k">"RELAY_URL"</span>: <span class="s">"${o.baseUrl}"</span>,
        <span class="k">"RELAY_OWNER_KEY"</span>: <span class="s">"your-owner-key"</span>
      }
    }
  }
}</pre>
</section>

<section class="principles" aria-label="Principles">
  <div class="principle"><h3>Zero token cost</h3><p>The server never calls a model. Claude on each person's own plan does the thinking.</p></div>
  <div class="principle"><h3>MCP is for creators</h3><p>Respondents need nothing but a link.</p></div>
  <div class="principle"><h3>One thin layer</h3><p>The MCP tools call the same API the pages use — no hidden logic.</p></div>
  <div class="principle"><h3>People send, not servers</h3><p>Whatever reaches a person is sent by a person.</p></div>
</section>`;
  return layout({
    title: "Relay — forms that travel through conversation",
    description: "Create forms from Claude, share two links, read the answers back.",
    body,
    host: o.host,
    wide: true,
  });
}
