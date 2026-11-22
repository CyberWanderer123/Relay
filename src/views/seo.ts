/* Search and AI-assistant discoverability: the public FAQ, structured data (JSON-LD), sitemap.xml and llms.txt.
   The FAQ shown on the home page and the FAQPage structured data come from the same list, so they never drift. */

import { REPO_URL } from "./pages.js";

export const SITE_NAME = "Relay";
/** "Relay" alone is ambiguous on the web; the MCP server and structured data also use this name. */
export const SITE_ALT_NAME = "Relay Forms";
export const SITE_DESCRIPTION =
  "Create forms by asking Claude, ChatGPT or any MCP assistant. Share one link, then ask what people said, with exact counts and NPS. Free and open source.";
export const OG_IMAGE_PATH = "/assets/og.png";
export const OG_IMAGE_SIZE = { width: 1200, height: 630 };

export interface SiteInfo {
  host: string;
  baseUrl: string;
  /** Hosted Relay: free accounts with a monthly response limit. */
  hosted?: { monthlyResponses: number };
}

export interface Faq {
  q: string;
  a: string;
}

export function faqs(s: SiteInfo): Faq[] {
  const list: Faq[] = [
    {
      q: "What is Relay?",
      a: "Relay (also called Relay Forms) is an open-source, agent-first form builder and analysis engine. You create forms by asking your AI assistant, share one link, then ask the assistant what people said. It connects to Claude, ChatGPT and other assistants through MCP, the Model Context Protocol.",
    },
    {
      q: "Can I create a form with ChatGPT or Claude?",
      a: `Yes. Add ${s.baseUrl}/mcp as a custom connector in Claude, ChatGPT or any MCP client and sign in. Then ask for a form, for example: "Make a sign-up for Saturday's workshop: 30 seats, close Friday 6pm." Your assistant creates it and gives you a link to share.`,
    },
    {
      q: "Is Relay free?",
      a: s.hosted
        ? `Yes. The hosted version at ${s.host} is free for up to ${s.hosted.monthlyResponses} responses a month. Relay is also open source under the MIT licence, so you can run your own copy for free with no limits.`
        : "Yes. Relay is open source under the MIT licence and free to run on your own server, or on Vercel with a free Turso database.",
    },
    {
      q: "Does Relay use AI on its servers?",
      a: "No. Relay never calls an AI model. Your own assistant does the thinking. Relay stores the answers, enforces the rules (deadlines, seat limits, safe edits) and calculates counts, averages and NPS exactly, so the numbers your assistant reports come from the database, not a guess.",
    },
    {
      q: "Can I host Relay myself?",
      a: "Yes. Deploy it to Vercel with one click and a free Turso database, or run it with Docker on your own server. A self-hosted Relay has no limits, and your data stays in your own database.",
    },
    {
      q: "Who can see the answers?",
      a: "Only the form's creator, through their connected assistant, CSV exports and any webhook they set up. Form pages are kept out of search engines, and Relay never sells data or shows ads.",
    },
  ];
  if (s.hosted) {
    list.push({
      q: "What if I lose my account key?",
      a: "Your account key is shown once when you sign up. It's how you sign in and reconnect your assistant, so save it in a password manager. Lost keys can't be recovered yet; key recovery is planned.",
    });
  }
  return list;
}

/** JSON-LD for the home page. Safe to place inside a <script> element: "<" is escaped. */
export function homeJsonLd(s: SiteInfo): string {
  const home = `${s.baseUrl}/`;
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${home}#website`,
        name: SITE_NAME,
        alternateName: SITE_ALT_NAME,
        url: home,
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${home}#app`,
        name: SITE_NAME,
        alternateName: SITE_ALT_NAME,
        description: SITE_DESCRIPTION,
        url: home,
        image: `${s.baseUrl}${OG_IMAGE_PATH}`,
        applicationCategory: "BusinessApplication",
        applicationSubCategory: "Form builder",
        operatingSystem: "Web",
        isAccessibleForFree: true,
        license: "https://opensource.org/licenses/MIT",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        sameAs: [REPO_URL],
        featureList: [
          "Create forms by talking to Claude, ChatGPT or any MCP client",
          "Conditional questions, ratings, 0–10 NPS scales, dates, links and phone numbers",
          "Seat limits, closing dates and a next-step button after submitting",
          "Exact counts, averages and NPS calculated on the server",
          "CSV export and signed webhooks",
          "Open source (MIT): host it yourself on Vercel or with Docker",
        ],
      },
      {
        "@type": "FAQPage",
        "@id": `${home}#faq`,
        mainEntity: faqs(s).map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
    ],
  };
  return JSON.stringify(graph).replace(/</g, "\\u003c");
}

/** Public, indexable pages. Forms, review pages and sign-in pages are private and stay out. */
export function sitemapXml(baseUrl: string): string {
  const urls = ["/", "/terms", "/privacy"].map((p) => `  <url><loc>${baseUrl}${p}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** llms.txt (llmstxt.org): a plain summary of the site for AI assistants and crawlers. */
export function llmsTxt(s: SiteInfo): string {
  const tools = [
    "create_form",
    "update_form",
    "list_forms",
    "get_form",
    "get_responses",
    "summarize_responses",
    "export_responses",
    "close_form",
  ];
  return [
    `# ${SITE_NAME} (${SITE_ALT_NAME})`,
    "",
    `> ${SITE_NAME} is an open-source, agent-first form builder and analysis engine. Create forms by asking your AI assistant (Claude, ChatGPT or any MCP client), share one link, and ask what people said. Relay never calls an AI model: the assistant does the thinking, and Relay stores the data, enforces the rules and calculates the numbers.`,
    "",
    "## Connect",
    "",
    `- MCP connector URL: ${s.baseUrl}/mcp (OAuth sign-in${s.hosted ? "; free accounts available" : ""})`,
    `- Tools: ${tools.join(", ")}`,
    "",
    "## Questions",
    "",
    ...faqs(s).flatMap((f) => [`### ${f.q}`, "", f.a, ""]),
    "## Links",
    "",
    `- [Home](${s.baseUrl}/): what Relay does and how to start`,
    `- [Source code](${REPO_URL}): MIT licence, setup guide, Docker and Vercel deploy`,
    `- [Agent-forms spec](${s.baseUrl}/spec): how assistants read a Relay form`,
    `- [Terms](${s.baseUrl}/terms) and [Privacy](${s.baseUrl}/privacy)`,
    "",
  ].join("\n");
}
