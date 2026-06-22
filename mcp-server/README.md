# AthleteIQ MCP server

Exposes Kelvin's Supabase fitness data (synced from Garmin via `garmin-sync/sync_once.py`)
as read-only MCP tools, so Claude Desktop / claude.ai can query activities, health
metrics, sleep, weight, profile/thresholds, and daily AI Brain insights directly —
no manual prompting needed to surface the right table.

This is separate from the in-app Groq-based coach (`app/api/coach/*`), which is
unchanged. Usage here is covered by an existing Claude subscription (no per-token
API billing), unlike the in-app coach.

## Tools exposed

- `get_recent_activities(limit, activity_type?)`
- `get_activity_detail(activity_id)`
- `get_health_metrics(start_date, end_date)`
- `get_sleep_data(start_date, end_date)`
- `get_weight_history(start_date, end_date)`
- `get_profile_and_thresholds()`
- `get_daily_insight(date?)`

All read-only SELECTs against Supabase, scoped to `SUPABASE_USER_ID`, using the
service role key (bypasses RLS — same as the sync worker).

## Auth

Protected by Google OAuth (`GoogleProvider`) rather than a static bearer token,
so it works with claude.ai's Connectors UI (web + iOS), which requires OAuth.
Every tool call additionally checks the authenticated Google account's email
against `ALLOWED_EMAIL` and rejects anyone else — this is a single-user server.

Setup requires a Google Cloud OAuth client (Console → APIs & Services →
Credentials → OAuth client ID → Web application), with an authorized redirect
URI of `<MCP_BASE_URL>/auth/callback`. See `.env.example` for the exact vars.

`MCP_JWT_SIGNING_KEY` must stay the same across restarts/redeploys — it signs
FastMCP's own session tokens, so rotating it forces every connected client to
re-authenticate.

## Run locally

```bash
cd mcp-server
pip install -r requirements.txt
cp .env.example .env   # fill in real values
python server.py
```

Server listens on `http://0.0.0.0:8000/mcp` (streamable-http transport).
First connection from any client triggers a Google login in the browser;
after that, sessions persist via FastMCP's own tokens.

## Deploying to the Proxmox cluster

Handoff for the Claude CLI session with Proxmox access:

1. Build the image from this directory: `docker build -t athleteiq-mcp .`
2. Run as an always-on container, e.g.:
   ```bash
   docker run -d --name athleteiq-mcp \
     --restart unless-stopped \
     -p 8000:8000 \
     --env-file .env \
     athleteiq-mcp
   ```
3. Persist `.env` (same vars as `.env.example`) on the host — do not bake any
   secret into the image. `MCP_JWT_SIGNING_KEY` especially must survive
   redeploys unchanged.
4. Expose port 8000 over real TLS at a stable public hostname — OAuth
   redirects require HTTPS, this isn't optional like the old bearer-token
   setup. (Already done: `https://athleteiq-mcp.fryski.duckdns.org` via Caddy.)
5. No changes needed in the main Next.js app or Vercel deployment — this is a
   fully separate process reading the same Supabase database.

## Connecting clients

**claude.ai (web) / Claude iOS app** — Settings → Connectors → Add custom
connector → paste `https://athleteiq-mcp.fryski.duckdns.org/mcp`. It will
walk you through the Google OAuth login itself.

**Claude Desktop** — this app's local `mcpServers` config schema only
supports `command`/`args` (no direct remote `url` field), so connect via the
`mcp-remote` bridge, which auto-detects the OAuth requirement and opens a
browser login on first connect:

```json
{
  "mcpServers": {
    "athleteiq": {
      "command": "node",
      "args": [
        "C:\\Users\\Kelv\\AppData\\Roaming\\npm\\node_modules\\mcp-remote\\dist\\proxy.js",
        "https://athleteiq-mcp.fryski.duckdns.org/mcp"
      ]
    }
  }
}
```

(Requires `npm install -g mcp-remote` first. Using `node` + the resolved
script path directly — rather than `npx`/`npx.cmd` — works around a bug in
this Claude Desktop build where it spawns `.cmd` files via `cmd.exe` without
quoting paths containing spaces, breaking on the default
`C:\Program Files\nodejs` install location.)
