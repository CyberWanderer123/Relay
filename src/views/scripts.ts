import crypto from "node:crypto";

/**
 * The only script Relay serves, used on form pages and the assistant fallback page. It does two
 * small things, and every page still works without it:
 *  - copy buttons copy the prepared message (without JS the text is selectable);
 *  - conditional questions hide until their condition is met (without JS they all show, each with
 *    an "Only if…" note, and the server ignores answers to questions that don't apply).
 */
export const PAGE_JS = `(() => {
  const msg = document.getElementById("relay-message");
  const status = document.getElementById("copy-status");
  if (msg) {
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(msg.value);
      } catch {
        msg.focus();
        msg.select();
        try { document.execCommand("copy"); } catch {}
      }
      if (status) status.textContent = "Copied. Paste it into your assistant and send.";
    };
    for (const el of document.querySelectorAll("[data-copy]")) {
      el.hidden = false;
      el.addEventListener("click", () => { void copy(); });
    }
    msg.addEventListener("focus", () => msg.select());
  }

  const form = document.querySelector("form[data-relay-form]");
  const conditional = [...document.querySelectorAll("[data-show-field]")];
  if (!form || !conditional.length) return;
  const picked = (name) =>
    [...form.elements]
      .filter((el) => el.name === name && !el.disabled && (el.type === "radio" || el.type === "checkbox" ? el.checked : el.value))
      .map((el) => el.value.toLowerCase());
  const update = () => {
    // Document order matches question order, and conditions only point backwards, so one pass
    // settles chains: a hidden question's inputs are disabled before later questions read them.
    for (const block of conditional) {
      const anyOf = JSON.parse(block.dataset.showAny || "[]").map((v) => String(v).toLowerCase());
      const show = picked(block.dataset.showField).some((v) => anyOf.includes(v));
      block.hidden = !show;
      for (const el of block.querySelectorAll("input, textarea, select")) el.disabled = !show;
    }
  };
  form.addEventListener("change", update);
  form.addEventListener("input", update);
  update();
})();
`;

export const PAGE_JS_VERSION = crypto.createHash("sha256").update(PAGE_JS).digest("hex").slice(0, 10);
