// Copies docs/agent-forms.md into src/spec.ts so the server can serve it at /spec
// without reading files at runtime (serverless bundles do not include docs/).
import { readFileSync, writeFileSync } from "node:fs";

const md = readFileSync(new URL("../docs/agent-forms.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
writeFileSync(
  new URL("../src/spec.ts", import.meta.url),
  `/* Generated from docs/agent-forms.md. Edit that file, then run: npm run spec */\nexport const SPEC_MD = ${JSON.stringify(md)};\n`,
);
