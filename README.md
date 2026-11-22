[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fanurag-ships%2FRelay&project-name=relay&repository-name=relay&env=RELAY_OWNER_KEY,TURSO_DATABASE_URL,TURSO_AUTH_TOKEN&envDescription=Your%20owner%20key%20(any%20long%20random%20secret)%20and%20your%20Turso%20database%20URL%20and%20token&envLink=https%3A%2F%2Fgithub.com%2Fanurag-ships%2FRelay%23deploy-to-vercel--turso-recommended)

# Relay

**Try it: [tryrelay.xyz](https://tryrelay.xyz)**. Add `https://tryrelay.xyz/mcp` as a connector in Claude, ChatGPT or any MCP client, and create a free account when asked.

**The agent-first form builder.** Make forms by chatting with your AI assistant, share one link, and ask how it's going. No dashboard, no drag and drop: your assistant builds the form, Relay runs it, and the answers come back to the same chat, counted and summarised.

- **Creators** work entirely through MCP from Claude, ChatGPT or any MCP client: create and edit forms, set seats and deadlines, read what's new, get exact summaries, export CSV.
- **Respondents** install nothing. They tap one link and fill a normal web form, or pick Claude, ChatGPT or any other assistant on that page. The assistant drafts answers from what it knows about them, and they confirm on a review page.
- **The server never calls a model.** Claude on each person's own plan does the thinking, so Relay's token cost is zero.

One TypeScript service (Hono + SQLite via libSQL). Deploy it to **Vercel with a Turso database**, or self-host it with Docker.


---

## Quick start (local)

Requires **Node 22.13 or later** and git. Locally Relay stores everything in a SQLite file (`data/relay.db`); there is nothing to compile and no database to install.

**1. Get the code and install:**

```bash
git clone https://github.com/anurag-ships/Relay.git
cd Relay
npm install
```

**2. Create your settings file** from the example:

```bash
cp .env.example .env
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead.

**3. Set an owner key.** Generate one, then paste it after `RELAY_OWNER_KEY=` in `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

**4. Try it:**

```bash
npm run seed    # creates a sample form and prints its links
npm run dev     # http://localhost:8787
```

Open the printed form link to fill it in. To create forms from an assistant, connect it as described in [Connecting Claude](#connecting-claude): Claude Desktop works against your local server, while Claude on the web needs Relay deployed on a public HTTPS address.

## Deploy to Vercel + Turso (recommended)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fanurag-ships%2FRelay&project-name=relay&repository-name=relay&env=RELAY_OWNER_KEY,TURSO_DATABASE_URL,TURSO_AUTH_TOKEN&envDescription=Your%20owner%20key%20(any%20long%20random%20secret)%20and%20your%20Turso%20database%20URL%20and%20token&envLink=https%3A%2F%2Fgithub.com%2Fanurag-ships%2FRelay%23deploy-to-vercel--turso-recommended)

The button copies Relay into your Vercel account and asks for `RELAY_OWNER_KEY` (any long random secret: it is the password to your Relay) and your Turso database URL and token. The steps below do the same by hand.

Vercel has no lasting disk, so the data lives in [Turso](https://turso.tech) — hosted SQLite with a free tier. Relay runs as a Vercel function from `src/index.ts`.

**1. Create the database** (Turso CLI, or the Turso dashboard):

```bash
turso db create relay
turso db show relay --url        # libsql://relay-<you>.turso.io
turso db tokens create relay     # the auth token
```

Tables are created automatically on the first request.

**2. Create the Vercel project.** Push this repo to GitHub, then import it at vercel.com/new. Framework preset: **Hono** (detected automatically). No build settings to change.

**3. Set environment variables** in Vercel → Project → Settings → Environment Variables:

| Variable | Value |
| --- | --- |
| `TURSO_DATABASE_URL` | `libsql://relay-<you>.turso.io` |
| `TURSO_AUTH_TOKEN` | the token from step 1 |
| `RELAY_OWNER_KEY` | a long random secret (see above) |
| `RELAY_BASE_URL` | optional — your custom domain; defaults to the project's `*.vercel.app` domain |

(Turso's Vercel integration can set the first two for you.) Redeploy after adding variables.

**4. Check it:** open `https://<project>.vercel.app/healthz`, then `/`.

Notes for Vercel:
- The per-IP submit limit is kept in memory per function instance, so on Vercel it is best-effort. Move it to a shared store (for example Upstash Redis) if spam appears.
- Vercel's free Hobby plan is for personal, non-commercial use.
- If the database variables are missing, Relay refuses to start on Vercel rather than writing to a disk that will be wiped.

## Self-hosting with Docker

1. Point a domain (for example `forms.example.com`) at your server.
2. Copy `Caddyfile.example` to `Caddyfile` and put your domain in it.
3. Start Relay behind Caddy, which handles HTTPS:

```bash
RELAY_BASE_URL=https://forms.example.com RELAY_OWNER_KEY=<your key> docker compose up -d --build
```

Or run the image on its own (put your own HTTPS proxy in front — never serve forms over plain HTTP):

```bash
docker build -t relay .
docker run -d -p 8787:8787 -v relay-data:/data -e RELAY_BASE_URL=https://forms.example.com -e RELAY_OWNER_KEY=<your key> relay
```

The SQLite file lives at `/data/relay.db` on the volume. **Back it up.** To use Turso instead, pass `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`.

## What a form can do

- **Question types:** short text, long text, single choice, multiple choice, number, email, date, rating (1–5 stars), scale (0–10, with optional end labels; summaries include NPS), web address and phone.
- **Thank-you page:** a custom message and an optional next-step button, e.g. "Book your call".
- **Deadline and limit:** `closes_at` and `max_responses`. The form shows "Closes …" and "N spots left", and closes itself.
- **Conditional questions:** `show_if: { field, any_of }` asks a question only when an earlier choice question was answered a certain way. The web form hides it until then; the server and assistants skip it.
- **Branding:** `brand.accent` (#RRGGBB, adjusted for readability) and `brand.logo_url`.
- **Embedding:** `embed_origins: ["https://example.com"]` lets those sites show the form in an iframe; `get_form` returns `links.embed_code`. Every other site is still refused.
- **Editing:** `update_form` keeps the link and refuses changes that would make existing answers misleading.
- **Export and events:** CSV export, and an optional webhook for every new response.

## Connecting Claude

### Claude on the web (any plan, including Free)

Relay must be deployed on a public HTTPS address first — Claude connects from Anthropic's cloud, so `localhost` will not work.

1. In Claude, open **Customize → Connectors → Add custom connector**.
2. URL: `https://<your-relay>/mcp`, with no key in it. Leave the sign-in setting on its default (OAuth).
3. Claude opens Relay's **Allow** page. Type your owner key once and press **Allow**.

Claude then gets its own token: an hour-long access token that renews itself, with a 30-day refresh token. Your owner key never leaves Relay. To cut every connected assistant off at once, change `RELAY_OWNER_KEY` and redeploy. Free accounts can add one custom connector.

Relay implements the MCP authorization spec (OAuth 2.1 with PKCE and dynamic client registration), so other MCP clients that support it connect the same way. Discovery starts at `/.well-known/oauth-protected-resource/mcp`.

Clients without OAuth can still send the owner key: an `Authorization: Bearer <owner key>` header, or `https://<your-relay>/mcp?key=<owner key>` as a last resort (treat that URL like a password).

### Claude Desktop (local MCP program)

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "relay": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/relay/src/mcp/stdio.ts"],
      "env": {
        "RELAY_URL": "https://forms.example.com",
        "RELAY_OWNER_KEY": "<your key>"
      }
    }
  }
}
```

With `RELAY_URL` set, the local program holds the key and calls your hosted API. Without it, the program opens the database directly (`TURSO_DATABASE_URL`, or the local file) and builds links from `RELAY_BASE_URL`.

### The eight tools

| Tool | Does |
| --- | --- |
| `create_form` | Validates a field list Claude drafted, saves it, returns the form link, direct links per assistant (Claude, ChatGPT), the review link template and the share message |
| `list_forms` | Every form with status, response count and how many responses are new since the creator last looked |
| `get_form` | One form's questions, status, links and share message (WhatsApp or email) |
| `update_form` | Edits the title, description or questions; the link stays the same. Refuses changes that would make existing answers misleading (a new type, removing a chosen option) |
| `get_responses` | A page of responses (max 50), newest first, with a cursor; or `only_new` for just the unseen ones, oldest first |
| `summarize_responses` | Choice counts, number stats, and up to 10 sample text answers per question |
| `export_responses` | A CSV download link (opens in Excel or Sheets) that works for 15 minutes without the key |
| `close_form` | Stops new responses |

No tool sends, emails or deletes anything. Responses come back inside a labelled `<relay_data>` block so the model reads them as content, not instructions.

## How respondents answer

**Browser:** `/f/:id` → fill in → Submit → thank-you page.

**Any assistant:** the form page has Claude and ChatGPT buttons (`/c/:id/claude`, `/c/:id/chatgpt`) and a copyable message for any other assistant. The buttons open a new chat with the whole form already in the message — questions, options and the review-link template. The respondent presses Send. Claude first drafts what it can from the respondent's memory and past chats, shows the draft, then asks only what is still open. (claude.ai shows a caution banner on every link that prefills a prompt; that cannot be turned off.) Nothing needs fetching, which matters because Claude will not fetch a link from a prefilled message. Claude asks the questions and hands back a review link (`/f/:id/review?q1=…&q2=…`); the person checks the answers and presses Submit. A GET never saves anything. Forms too long for a link (over 8,000 characters) get a copy-and-paste page instead, pointing Claude at `/a/:id`.

Both paths end at the same validated `POST /f/:id/submit`.

## HTTP routes

Public: `GET /f/:id` (send `Accept: text/plain` for the agent version) · `POST /f/:id/submit` · `GET /a/:id` (also `/f/:id/clean`) · `GET /f/:id/review` · `GET /c/:id/:assistant` · `GET /spec`

**Agent forms spec:** [docs/agent-forms.md](docs/agent-forms.md), also served at `/spec`, is the public contract for how assistants read a form and build the review link. After editing it, run `npm run spec`.

OAuth for MCP connectors: `GET /.well-known/oauth-protected-resource[/mcp]` · `GET /.well-known/oauth-authorization-server` · `POST /oauth/register` · `GET|POST /oauth/authorize` · `POST /oauth/token` · `POST /oauth/revoke`

Creator API (Bearer key): `POST /api/forms` · `GET /api/forms` · `GET /api/forms/:id` · `PUT /api/forms/:id` · `GET /api/forms/:id/responses?limit=&cursor=&only_new=1` · `GET /api/forms/:id/responses.csv` · `POST /api/forms/:id/export-link` · `GET /api/forms/:id/summary` · `POST /api/forms/:id/close` · `DELETE /api/forms/:id`

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `RELAY_BASE_URL` | `http://localhost:8787` (on Vercel: the production domain) | Public origin used in every link |
| `RELAY_OWNER_KEY` | — | Creator key; `/api` and `/mcp` are disabled without it |
| `RELAY_HOSTED` | off | Hosted mode: anyone can create a free account on the Allow page when connecting an assistant. Off means one owner (you) |
| `RELAY_MONTHLY_RESPONSES` | `250` | Hosted mode: responses a free account's forms can take per calendar month (UTC) before they pause |
| `RELAY_CONTACT_EMAIL` | — | Hosted mode: shown to people who reach the free limit |
| `RELAY_WEBHOOK_URL` | — | Optional. Receives a JSON `POST` (`event: "response.created"`) for every new response |
| `RELAY_WEBHOOK_SECRET` | — | Optional. Signs webhook bodies: `X-Relay-Signature: sha256=<HMAC-SHA256 of the body>` |
| `TURSO_DATABASE_URL` (or `RELAY_DB_URL`) | `file:./data/relay.db` | `libsql://…` for Turso, `file:…` for a local SQLite file |
| `TURSO_AUTH_TOKEN` (or `RELAY_DB_AUTH_TOKEN`) | — | Turso auth token |
| `RELAY_DB_PATH` | — | Older form of a local file path, still accepted |
| `RELAY_TRUST_PROXY` | on for Vercel, otherwise off | Read client IPs from `X-Forwarded-For` (only behind a proxy you trust) |
| `RELAY_SUBMIT_PER_MINUTE` | `10` | Submissions per IP per minute |
| `PORT` | `8787` | Listen port (local server only) |

## Security notes

- Every value in HTML is escaped; pages send a strict Content-Security-Policy with no inline scripts or styles. Form pages load one small same-origin script (copy buttons and conditional questions); every page works without it.
- Forms refuse to be framed unless they list the sites allowed to embed them.
- Connectors sign in with OAuth 2.1: PKCE (S256) is required, codes are single-use and expire in 10 minutes, refresh tokens rotate, and codes and tokens are stored only as SHA-256 hashes. Errors before an app's return address is verified are shown on Relay's own page, never redirected. The approval page is rate-limited against key guessing.
- `/clean` starts with fixed instructions written by the service. Creator text sits below, labelled as data, with control characters stripped and lengths capped.
- The review page shows every answer and the destination domain before Submit.
- `Referrer-Policy: no-referrer`; request logs record method, path and status only — never query strings, since review links carry answers.
- Submissions are rate-limited per IP, bodies are capped at 32 KB, answers are capped per field, unknown field ids are rejected, and a hidden honeypot field drops bots.

## Hosting Relay for other people

Set `RELAY_HOSTED=1` to let anyone use your Relay with a free account:

- **Sign-up happens while connecting.** Someone adds `https://<your-relay>/mcp` as a connector; on Relay's Allow page they choose **Create a free account**, get an account key (shown once, stored only as a hash), and continue. They sign in again later with that key.
- **Accounts are separate.** Each account sees and manages only its own forms, through MCP and the API. Respondents reach any form by its link, as before.
- **Free monthly limit.** A free account's forms take `RELAY_MONTHLY_RESPONSES` (default 250) responses per calendar month in total. At the limit they pause until the 1st: respondents see a polite notice, and the creator's assistant is told to run their own Relay or email `RELAY_CONTACT_EMAIL`. The account gets a warning at 80%.
- **You stay unlimited.** Your `RELAY_OWNER_KEY` is the operator account: no limit, and your existing forms are yours.
- **Your webhook stays yours.** `RELAY_WEBHOOK_URL` only receives responses to your own forms, never other accounts'.

## Your data duties

Responses are personal data, and **whoever hosts Relay is responsible for them.** Keep the database on a persistent, backed-up volume, and delete forms you no longer need:

```bash
npm run forms:delete -- <form-id>          # shows what will be deleted
npm run forms:delete -- <form-id> --yes    # deletes the form and all its responses
```

In Docker: `docker compose exec relay node dist/cli/delete-form.js <form-id> --yes`. Or call `DELETE /api/forms/:id` with the owner key.

## Development

```bash
npm test          # vitest: validation, agent text snapshots, review links, escaping, limits, MCP tools
npm run typecheck
npm run build     # compiles to dist/
npm run spec      # after editing docs/agent-forms.md, copies it into src/spec.ts
```

**Project layout**

| Path | What's there |
| --- | --- |
| `src/service.ts` | All form logic; the API, pages and MCP tools call it |
| `src/schema.ts` | Question types, validation, conditions, settings |
| `src/mcp/` | The MCP tools, served at `/mcp` (remote) or over stdio (local) |
| `src/routes/` | HTTP routes: forms, review, assistant links, API, export |
| `src/views/` | Server-rendered pages, styles and the one page script |
| `src/clean.ts` | The plain-text version of a form for assistants |
| `docs/agent-forms.md` | The agent-forms spec, also served at `/spec` |
| `test/` | Vitest suites |

`test/__snapshots__/clean.test.ts.snap` holds the exact `/clean` text. Any change to the assistant instructions shows up there in review — update it deliberately with `npx vitest run -u`.
