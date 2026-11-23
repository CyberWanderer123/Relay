import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { faqs } from "../src/views/seo.js";
import { USE_CASES } from "../src/views/use-cases.js";
import { setup } from "./helpers.js";

const hosted = () => setup({ hosted: true, monthlyResponses: 250 });

function jsonLd(html: string) {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  expect(m).not.toBeNull();
  return JSON.parse(m![1]!) as { "@type"?: string; "@graph": Array<Record<string, unknown>> };
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

  it("every use case has its own page, linked from the home page, the index and the sitemap", async () => {
    const { app } = hosted();
    const home = await (await app.request("/")).text();
    const index = await (await app.request("/for")).text();
    const xml = await (await app.request("/sitemap.xml")).text();
    const titles = new Set<string>();
    for (const u of USE_CASES) {
      const res = await app.request(`/for/${u.slug}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toContain("public");
      const html = await res.text();
      expect(html).toContain(`<link rel="canonical" href="https://relay.test/for/${u.slug}">`);
      expect(html).toContain("https://relay.test/mcp");
      expect(html).toContain("can't be recovered yet");
      expect(jsonLd(html)["@type"]).toBe("BreadcrumbList");
      for (const r of u.related) expect(USE_CASES.some((x) => x.slug === r)).toBe(true);
      expect(home).toContain(`href="/for/${u.slug}"`);
      expect(index).toContain(`href="/for/${u.slug}"`);
      expect(xml).toContain(`<loc>https://relay.test/for/${u.slug}</loc>`);
      titles.add(u.metaTitle);
    }
    expect(titles.size).toBe(USE_CASES.length);
    expect((await app.request("/for/nope")).status).toBe(404);
  });

  it("analytics is off by default and only on Vercel when RELAY_ANALYTICS is set", () => {
    expect(loadConfig({ RELAY_ANALYTICS: "1" }).analytics).toBe(false);
    expect(loadConfig({ VERCEL: "1", TURSO_DATABASE_URL: "libsql://x" }).analytics).toBe(false);
    expect(loadConfig({ VERCEL: "1", RELAY_ANALYTICS: "1" }).analytics).toBe(true);
  });

  it("with analytics on, public pages load the script and allow it in the CSP; private pages don't", async () => {
    const tag = '<script src="/_vercel/insights/script.js" defer></script>';
    const { app, relay } = setup({ analytics: true });
    for (const path of ["/", "/for", "/for/event-rsvp", "/terms", "/privacy"]) {
      const res = await app.request(path);
      expect(res.status).toBe(200);
      const csp = res.headers.get("content-security-policy")!;
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("connect-src 'self'");
      const html = await res.text();
      expect(html).toContain(`${tag}\n</head>`);
    }
    expect(await (await app.request("/privacy")).text()).toContain("Vercel Web Analytics");
    const { id } = await relay.createForm({ title: "T", fields: [{ id: "a", type: "short_text", label: "A" }] });
    for (const path of [`/f/${id}`, `/a/${id}`, "/for/nope", "/sitemap.xml"]) {
      const res = await app.request(path);
      expect(await res.text()).not.toContain("_vercel/insights");
      expect(res.headers.get("content-security-policy")).not.toContain("connect-src");
    }
    const off = await (await setup().app.request("/privacy")).text();
    expect(off).not.toContain("_vercel/insights");
    expect(off).not.toContain("Vercel Web Analytics");
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
