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

## Run locally

```bash
cd mcp-server
pip install -r requirements.txt
cp .env.example .env   # fill in real values
python server.py
```

Server listens on `http://0.0.0.0:8000/mcp` (streamable-http transport) and
requires `Authorization: Bearer <MCP_AUTH_TOKEN>` on every request.

Test with the MCP inspector:

```bash
npx @modelcontextprotocol/inspector
# Connect to http://localhost:8000/mcp, transport "Streamable HTTP",
# header Authorization: Bearer <your MCP_AUTH_TOKEN>
```

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
3. Persist `.env` (same vars as `.env.example`) on the host — do not bake the
   service role key or `MCP_AUTH_TOKEN` into the image.
4. Expose port 8000 on a stable hostname/IP reachable from wherever Claude
   Desktop runs (LAN, Tailscale, or a reverse proxy with TLS — recommended if
   reachable from outside the LAN, since this currently sends the bearer
   token over plain HTTP).
5. No changes needed in the main Next.js app or Vercel deployment — this is a
   fully separate process reading the same Supabase database.

## Connecting Claude Desktop

In Claude Desktop's MCP settings, add a remote server:

```json
{
  "mcpServers": {
    "athleteiq": {
      "url": "http://<proxmox-host>:8000/mcp",
      "transport": "streamable-http",
      "headers": {
        "Authorization": "Bearer <your MCP_AUTH_TOKEN>"
      }
    }
  }
}
```

(Exact config key names may differ slightly by Claude Desktop version — check
the current remote MCP server docs if this doesn't connect.)
