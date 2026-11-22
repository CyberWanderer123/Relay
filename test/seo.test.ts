import { describe, expect, it } from "vitest";
import { faqs } from "../src/views/seo.js";
import { setup } from "./helpers.js";

const hosted = () => setup({ hosted: true, monthlyResponses: 250 });

function jsonLd(html: string) {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  expect(m).not.toBeNull();
  return JSON.parse(m![1]!) as { "@graph": Array<Record<string, unknown>> };
}

describe("search and link previews", () => {
  it("home page has a canonical URL, link-preview tags and a real title", async () => {
    const html = await (await setup().app.request("/")).text();
    expect(html).toContain('<link rel="canonical" href="https://relay.test/">');
    expect(html).toContain('<meta property="og:image" content="https://relay.test/assets/og.png">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html).toContain("<title>Relay Forms — agent-first form builder for Claude and ChatGPT</title>");
    expect(html).not.toContain('name="robots"');
  });

  it("structured data parses and its FAQ matches the visible questions", async () => {
    const html = await (await hosted().app.request("/")).text();
    const graph = jsonLd(html)["@graph"];
    const types = graph.map((n) => n["@type"]);
    expect(types).toEqual(["WebSite", "SoftwareApplication", "FAQPage"]);
    const faqNode = graph[2] as { mainEntity: Array<{ name: string }> };
    const visible = faqs({ host: "relay.test", baseUrl: "https://relay.test", hosted: { monthlyResponses: 250 } });
    expect(faqNode.mainEntity.map((q) => q.name)).toEqual(visible.map((f) => f.q));
    for (const f of visible) expect(html).toContain(`<h3>${f.q.replace(/'/g, "&#39;")}</h3>`);
  });

  it("only hosted Relays mention account keys and the free limit in the FAQ", async () => {
    const self = await (await setup().app.request("/")).text();
    expect(self).not.toContain("What if I lose my account key?");
    const html = await (await hosted().app.request("/")).text();
    expect(html).toContain("What if I lose my account key?");
    expect(html).toContain("free for up to 250 responses a month");
  });

  it("serves a sitemap of public pages only, linked from robots.txt", async () => {
    const { app } = setup();
    const res = await app.request("/sitemap.xml");
    expect(res.headers.get("content-type")).toContain("application/xml");
    const xml = await res.text();
    expect(xml).toContain("<loc>https://relay.test/</loc>");
    expect(xml).toContain("<loc>https://relay.test/privacy</loc>");
    expect(xml).not.toMatch(/\/(f|a|c|api|oauth)\//);
    expect(await (await app.request("/robots.txt")).text()).toContain("Sitemap: https://relay.test/sitemap.xml");
  });

  it("serves llms.txt with the connector address and the FAQ", async () => {
    const txt = await (await hosted().app.request("/llms.txt")).text();
    expect(txt.startsWith("# Relay (Relay Forms)")).toBe(true);
    expect(txt).toContain("https://relay.test/mcp");
    expect(txt).toContain("### Does Relay use AI on its servers?");
  });

  it("serves the preview image as a cacheable PNG", async () => {
    const res = await setup().app.request("/assets/og.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("public");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(1, 4)].map((b) => String.fromCharCode(b)).join("")).toBe("PNG");
  });

  it("legal pages are cacheable and have their own canonical URL; form pages stay private", async () => {
    const { app, relay } = setup();
    const terms = await app.request("/terms");
    expect(terms.headers.get("cache-control")).toContain("public");
    expect(await terms.text()).toContain('<link rel="canonical" href="https://relay.test/terms">');
    const { id } = await relay.createForm({ title: "T", fields: [{ id: "a", type: "short_text", label: "A" }] });
    const form = await (await app.request(`/f/${id}`)).text();
    expect(form).not.toContain("og:image");
    expect(form).not.toContain("application/ld+json");
  });
});
