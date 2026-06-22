# Prompt for the Proxmox-side Claude CLI session

Copy everything below into that session.

---

I need you to deploy a small MCP server on this Proxmox cluster. It's a Python app that exposes my AthleteIQ fitness data (stored in Supabase) as read-only tools for Claude Desktop to query — things like recent Garmin activities, sleep, HRV, weight history, etc. It does not touch the cluster's other workloads; it's a standalone container.

The code already exists — pull it from:

```
git clone https://github.com/kmfry1979/workout-ai-app.git
cd workout-ai-app
git checkout claude/eloquent-mclean-d9187b
cd mcp-server
```

(That branch may have been merged into `main` by the time you read this — if `claude/eloquent-mclean-d9187b` no longer exists, just use `main` instead; the `mcp-server/` directory should still be there.)

Use that `mcp-server/` directory as-is rather than writing the code from scratch. It contains:
- `server.py`, `supabase_client.py` — the app
- `requirements.txt`, `Dockerfile`
- `.env.example` — the env vars it needs
- `README.md` — has a "Deploying to the Proxmox cluster" section with the exact docker run command

Please do the following:

1. **Get the code onto a host/VM/LXC in the cluster** that's appropriate for an always-on lightweight Docker container (doesn't need GPU or much RAM — this just proxies HTTP requests to Supabase's REST API).

2. **Create the real `.env` file** next to the Dockerfile, based on `.env.example`, with these values (ask me for the actual secrets if you don't already have them from the main app's deployment — do NOT invent placeholder values and leave them in):
   - `SUPABASE_URL` — same Supabase project the main app uses
   - `SUPABASE_SERVICE_ROLE_KEY` — same service role key the `garmin-sync` worker uses (it's an env var in that GitHub Actions workflow / wherever it's currently stored)
   - `SUPABASE_USER_ID` — Kelvin's auth.users UUID, same one `garmin-sync` uses
   - `MCP_AUTH_TOKEN` — generate a fresh long random secret yourself (e.g. `python -c "import secrets; print(secrets.token_urlsafe(32))"`), don't reuse another credential. Tell me what it is at the end so I can put it in Claude Desktop's config.
   - `PORT` — 8000 is fine unless it collides with something else on that host

3. **Build and run the container** as an always-on service:
   ```bash
   docker build -t athleteiq-mcp .
   docker run -d --name athleteiq-mcp \
     --restart unless-stopped \
     -p 8000:8000 \
     --env-file .env \
     athleteiq-mcp
   ```
   Pick a port mapping that doesn't conflict with anything else already running on that host.

4. **Make it reachable from outside the cluster** — I'll be connecting to it from Claude Desktop on my regular machine, not from inside the cluster's network. Use whatever's appropriate here (existing reverse proxy, Tailscale, port forward, etc. — you know this cluster's setup better than I do). Since this sends a bearer token over the wire, prefer TLS if the route leaves the LAN — don't expose it on plain HTTP over the public internet if you can avoid it.

5. **Verify it works**: confirm the container is running and the `/mcp` endpoint responds (a request without the correct `Authorization: Bearer <token>` header should be rejected; one with it should succeed). You can test with `npx @modelcontextprotocol/inspector` pointed at the URL, or curl.

6. **Report back to me**:
   - The final URL I should point Claude Desktop at
   - The `MCP_AUTH_TOKEN` value
   - Anything about the access route (Tailscale, VPN, etc.) I need to have set up on my end to reach it

Don't change anything in the main `workout-ai-app` Next.js app or its Vercel deployment — this is a fully separate process that only reads from the same Supabase database.
