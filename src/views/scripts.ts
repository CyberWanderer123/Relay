import crypto from "node:crypto";

/**
 * The only script Relay serves, used on /c/:id. It copies the prepared message to the clipboard.
 * Without it the page still works: the message is plain selectable text and the Claude link opens.
 */
export const COPY_JS = `(() => {
  const msg = document.getElementById("relay-message");
  const status = document.getElementById("copy-status");
  if (!msg) return;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(msg.value);
    } catch {
      msg.focus();
      msg.select();
      try { document.execCommand("copy"); } catch {}
    }
    if (status) status.textContent = "Copied. Paste it into Claude and send.";
  };
  for (const el of document.querySelectorAll("[data-copy]")) {
    el.hidden = false;
    el.addEventListener("click", () => { void copy(); });
  }
  msg.addEventListener("focus", () => msg.select());
})();
`;

export const COPY_JS_VERSION = crypto.createHash("sha256").update(COPY_JS).digest("hex").slice(0, 10);
