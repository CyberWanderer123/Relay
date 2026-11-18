# Relay

**Forms that travel through conversation.** Make a form from Claude, send one message with two links, and read the answers back in the same chat.

- **Creators** work entirely through MCP: create a form, get a ready-to-paste share message, list forms, read and summarize responses, close a form.
- **Respondents** install nothing. They tap a link and fill a normal web form — or tap the Claude link, answer in a chat, and confirm on a review page.
- **The server never calls a model.** Claude on each person's own plan does the thinking, so Relay's token cost is zero.

One TypeScript service (Hono + SQLite via libSQL). Deploy it to **Vercel with a Turso database**, or self-host it with Docker.

---

## Quick start (local)

Requires Node 22.13 or later. Locally Relay stores everything in a SQLite file (`data/relay.db`); nothing to compile.

```bash
npm install
cp .env.example .env          # then set RELAY_OWNER_KEY
npm run seed                  # creates a sample form and prints its links
npm run dev                   # http://localhost:8787
```

Generate an owner key:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

## Deploy to Vercel + Turso (recommended)

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

## Connecting Claude

### Claude on the web (any plan, including Free)

Relay must be deployed on a public HTTPS address first — Claude connects from Anthropic's cloud, so `localhost` will not work.

1. In Claude, open **Customize → Connectors → Add custom connector**.
2. URL: `https://<your-relay>/mcp`
3. Sign-in: **No sign-in**, then add a request header `Authorization` with the value `Bearer <your owner key>` (type the word `Bearer` and the space yourself).

If your connector screen only takes a URL, use `https://<your-relay>/mcp?key=<your owner key>` instead, and treat that URL like a password. Free accounts can add one custom connector.

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

### The six tools

| Tool | Does |
| --- | --- |
| `create_form` | Validates a field list Claude drafted, saves it, returns the fill link, Claude link and share message |
| `list_forms` | Every form with status and response count |
| `get_form` | One form's questions, status, links and share message (WhatsApp or email) |
| `get_responses` | A page of responses (max 50), newest first, with a cursor |
| `summarize_responses` | Choice counts, number stats, and up to 10 sample text answers per question |
| `close_form` | Stops new responses; the only change after creation |

No tool sends, emails or deletes anything. Responses come back inside a labelled `<relay_data>` block so the model reads them as content, not instructions.

## How respondents answer

**Browser:** `/f/:id` → fill in → Submit → thank-you page.

**Plain Claude:** `/c/:id` opens a new Claude chat with a short prefilled message pointing at `/f/:id/clean`. Claude reads the plain-text form, asks the questions, and hands back a review link (`/f/:id/review?q1=…&q2=…`). The person checks the answers on the review page and presses Submit. A GET never saves anything.

Both paths end at the same validated `POST /f/:id/submit`.

## HTTP routes

Public: `GET /f/:id` · `POST /f/:id/submit` · `GET /f/:id/clean` · `GET /f/:id/review` · `GET /c/:id`

Creator API (Bearer key): `POST /api/forms` · `GET /api/forms` · `GET /api/forms/:id` · `GET /api/forms/:id/responses?limit=&cursor=` · `GET /api/forms/:id/summary` · `POST /api/forms/:id/close` · `DELETE /api/forms/:id`

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `RELAY_BASE_URL` | `http://localhost:8787` (on Vercel: the production domain) | Public origin used in every link |
| `RELAY_OWNER_KEY` | — | Creator key; `/api` and `/mcp` are disabled without it |
| `TURSO_DATABASE_URL` (or `RELAY_DB_URL`) | `file:./data/relay.db` | `libsql://…` for Turso, `file:…` for a local SQLite file |
| `TURSO_AUTH_TOKEN` (or `RELAY_DB_AUTH_TOKEN`) | — | Turso auth token |
| `RELAY_DB_PATH` | — | Older form of a local file path, still accepted |
| `RELAY_TRUST_PROXY` | on for Vercel, otherwise off | Read client IPs from `X-Forwarded-For` (only behind a proxy you trust) |
| `RELAY_SUBMIT_PER_MINUTE` | `10` | Submissions per IP per minute |
| `PORT` | `8787` | Listen port (local server only) |

## Security notes

- Every value in HTML is escaped; pages send a strict Content-Security-Policy with no scripts at all.
- `/clean` starts with fixed instructions written by the service. Creator text sits below, labelled as data, with control characters stripped and lengths capped.
- The review page shows every answer and the destination domain before Submit.
- `Referrer-Policy: no-referrer`; request logs record method, path and status only — never query strings, since review links carry answers.
- Submissions are rate-limited per IP, bodies are capped at 32 KB, answers are capped per field, unknown field ids are rejected, and a hidden honeypot field drops bots.

## Your data duties

Responses are personal data, and **whoever hosts Relay is responsible for them.** Keep the database on a persistent, backed-up volume, and delete forms you no longer need:

```bash
npm run forms:delete -- <form-id>          # shows what will be deleted
npm run forms:delete -- <form-id> --yes    # deletes the form and all its responses
```

In Docker: `docker compose exec relay node dist/cli/delete-form.js <form-id> --yes`. Or call `DELETE /api/forms/:id` with the owner key.

## Development

```bash
npm test          # vitest: validation, /clean snapshot, review links, escaping, limits, MCP tools
npm run typecheck
npm run build     # compiles to dist/
```

`test/__snapshots__/clean.test.ts.snap` holds the exact `/clean` text. Any change to the assistant instructions shows up there in review — update it deliberately with `npx vitest run -u`.
