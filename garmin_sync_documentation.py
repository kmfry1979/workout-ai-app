"""
Generate Garmin Sync Documentation PDF
"""
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib.colors import HexColor, white, black
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, PageBreak, KeepTogether
)
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY
from reportlab.platypus import Flowable
from datetime import date

OUTPUT = "C:/Users/Kelv/workout-ai-app/Garmin_Sync_Documentation.pdf"

# ── Colours ────────────────────────────────────────────────────────────────────
ORANGE    = HexColor("#F97316")
DARK_BG   = HexColor("#1a1a2e")
DARK_CARD = HexColor("#16213e")
MID_GREY  = HexColor("#374151")
LIGHT_GREY= HexColor("#9CA3AF")
GREEN     = HexColor("#22C55E")
RED       = HexColor("#EF4444")
YELLOW    = HexColor("#EAB308")
BLUE      = HexColor("#3B82F6")
CODE_BG   = HexColor("#1E293B")
CODE_FG   = HexColor("#E2E8F0")

W, H = A4

# ── Styles ─────────────────────────────────────────────────────────────────────
styles = getSampleStyleSheet()

def s(name, **kw):
    return ParagraphStyle(name, **kw)

COVER_TITLE = s("CoverTitle",
    fontSize=32, fontName="Helvetica-Bold", textColor=white,
    alignment=TA_CENTER, spaceAfter=8)

COVER_SUB = s("CoverSub",
    fontSize=14, fontName="Helvetica", textColor=ORANGE,
    alignment=TA_CENTER, spaceAfter=6)

COVER_DATE = s("CoverDate",
    fontSize=11, fontName="Helvetica", textColor=LIGHT_GREY,
    alignment=TA_CENTER)

H1 = s("H1",
    fontSize=20, fontName="Helvetica-Bold", textColor=ORANGE,
    spaceBefore=18, spaceAfter=8, borderPadding=(0,0,4,0))

H2 = s("H2",
    fontSize=14, fontName="Helvetica-Bold", textColor=white,
    spaceBefore=14, spaceAfter=6)

H3 = s("H3",
    fontSize=11, fontName="Helvetica-Bold", textColor=ORANGE,
    spaceBefore=10, spaceAfter=4)

BODY = s("Body",
    fontSize=10, fontName="Helvetica", textColor=HexColor("#D1D5DB"),
    spaceBefore=4, spaceAfter=4, leading=16, alignment=TA_JUSTIFY)

BODY_BOLD = s("BodyBold",
    fontSize=10, fontName="Helvetica-Bold", textColor=white,
    spaceBefore=4, spaceAfter=4, leading=16)

CODE = s("Code",
    fontSize=8.5, fontName="Courier", textColor=CODE_FG,
    backColor=CODE_BG, spaceBefore=4, spaceAfter=4,
    leftIndent=10, rightIndent=10, leading=13,
    borderPadding=(6,8,6,8))

BULLET = s("Bullet",
    fontSize=10, fontName="Helvetica", textColor=HexColor("#D1D5DB"),
    spaceBefore=3, spaceAfter=3, leading=16,
    leftIndent=16, bulletIndent=4)

NOTE = s("Note",
    fontSize=9, fontName="Helvetica-Oblique", textColor=YELLOW,
    spaceBefore=4, spaceAfter=4, leading=14,
    leftIndent=10, borderPadding=(4,6,4,6))

WARN = s("Warn",
    fontSize=9, fontName="Helvetica-Bold", textColor=RED,
    spaceBefore=4, spaceAfter=4, leading=14, leftIndent=10)

# ── Helpers ────────────────────────────────────────────────────────────────────
def HR():
    return HRFlowable(width="100%", thickness=1, color=MID_GREY,
                      spaceAfter=8, spaceBefore=8)

def SP(h=6):
    return Spacer(1, h)

def p(text, style=BODY):
    return Paragraph(text, style)

def h1(text): return p(text, H1)
def h2(text): return p(text, H2)
def h3(text): return p(text, H3)
def body(text): return p(text, BODY)
def bold(text): return p(text, BODY_BOLD)
def code(text): return p(text.replace("\n","<br/>").replace(" ","&nbsp;"), CODE)
def note(text): return p(f"&#9432; {text}", NOTE)
def warn(text): return p(f"&#9888; {text}", WARN)

def bullet(items, style=BULLET):
    return [p(f"&#8226;&nbsp;&nbsp;{i}", style) for i in items]

def table(data, col_widths, header_bg=MID_GREY):
    t = Table(data, colWidths=col_widths, repeatRows=1)
    style_cmds = [
        ("BACKGROUND", (0,0), (-1,0), header_bg),
        ("TEXTCOLOR",  (0,0), (-1,0), white),
        ("FONTNAME",   (0,0), (-1,0), "Helvetica-Bold"),
        ("FONTSIZE",   (0,0), (-1,0), 9),
        ("ALIGN",      (0,0), (-1,0), "LEFT"),
        ("BACKGROUND", (0,1), (-1,-1), CODE_BG),
        ("TEXTCOLOR",  (0,1), (-1,-1), HexColor("#D1D5DB")),
        ("FONTNAME",   (0,1), (-1,-1), "Helvetica"),
        ("FONTSIZE",   (0,1), (-1,-1), 8.5),
        ("ROWBACKGROUNDS", (0,1), (-1,-1), [CODE_BG, HexColor("#243044")]),
        ("GRID",       (0,0), (-1,-1), 0.5, MID_GREY),
        ("LEFTPADDING",(0,0), (-1,-1), 8),
        ("RIGHTPADDING",(0,0),(-1,-1), 8),
        ("TOPPADDING", (0,0), (-1,-1), 6),
        ("BOTTOMPADDING",(0,0),(-1,-1),6),
        ("VALIGN",     (0,0), (-1,-1), "TOP"),
    ]
    t.setStyle(TableStyle(style_cmds))
    return t

class ColorBox(Flowable):
    """A coloured background box with a label."""
    def __init__(self, label, bg=DARK_CARD, fg=ORANGE, width=None, height=30):
        self.label = label
        self.bg = bg
        self.fg = fg
        self.bw = width
        self.bh = height
    def wrap(self, aw, ah):
        self.bw = self.bw or aw
        return self.bw, self.bh
    def draw(self):
        self.canv.setFillColor(self.bg)
        self.canv.roundRect(0, 0, self.bw, self.bh, 6, fill=1, stroke=0)
        self.canv.setFillColor(self.fg)
        self.canv.setFont("Helvetica-Bold", 11)
        self.canv.drawString(10, 9, self.label)


def cover_page_bg(canvas, doc):
    """Dark gradient cover page background."""
    canvas.saveState()
    canvas.setFillColor(DARK_BG)
    canvas.rect(0, 0, W, H, fill=1, stroke=0)
    # Orange accent bar top
    canvas.setFillColor(ORANGE)
    canvas.rect(0, H-6, W, 6, fill=1, stroke=0)
    # Orange accent bar bottom
    canvas.rect(0, 0, W, 4, fill=1, stroke=0)
    canvas.restoreState()

def normal_page_bg(canvas, doc):
    """Dark background for all pages."""
    canvas.saveState()
    canvas.setFillColor(DARK_BG)
    canvas.rect(0, 0, W, H, fill=1, stroke=0)
    # thin orange top bar
    canvas.setFillColor(ORANGE)
    canvas.rect(0, H-3, W, 3, fill=1, stroke=0)
    # footer
    canvas.setFillColor(LIGHT_GREY)
    canvas.setFont("Helvetica", 8)
    canvas.drawString(2*cm, 1.2*cm,
        f"Workout AI App — Garmin Sync Documentation — {date.today().strftime('%d %B %Y')}")
    canvas.drawRightString(W - 2*cm, 1.2*cm, f"Page {doc.page}")
    canvas.restoreState()

# ── Document ───────────────────────────────────────────────────────────────────
doc = SimpleDocTemplate(
    OUTPUT,
    pagesize=A4,
    leftMargin=2*cm, rightMargin=2*cm,
    topMargin=2.5*cm, bottomMargin=2.5*cm,
    title="Garmin Sync Documentation",
    author="Kelvin Fry",
)

story = []

# ═══════════════════════════════════════════════════════════════════════════════
# COVER PAGE
# ═══════════════════════════════════════════════════════════════════════════════
from reportlab.platypus import FrameBreak

story.append(SP(100))
story.append(p("WORKOUT AI APP", COVER_TITLE))
story.append(SP(6))
story.append(p("Garmin Sync — Technical Reference & Troubleshooting Guide", COVER_SUB))
story.append(SP(20))

cover_table_data = [
    [p("Author", NOTE), p("Kelvin Fry", BODY_BOLD)],
    [p("Date",   NOTE), p(date.today().strftime("%d %B %Y"), BODY_BOLD)],
    [p("Version",NOTE), p("2.0 — garminconnect v0.3.x (JWT auth)", BODY_BOLD)],
    [p("Stack",  NOTE), p("Next.js · Supabase · GitHub Actions · Python", BODY_BOLD)],
]
ct = Table(cover_table_data, colWidths=[4*cm, 12*cm])
ct.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,-1), DARK_CARD),
    ("GRID", (0,0), (-1,-1), 0.5, MID_GREY),
    ("LEFTPADDING",  (0,0), (-1,-1), 10),
    ("RIGHTPADDING", (0,0), (-1,-1), 10),
    ("TOPPADDING",   (0,0), (-1,-1), 8),
    ("BOTTOMPADDING",(0,0), (-1,-1), 8),
]))
story.append(ct)
story.append(SP(30))
story.append(p(
    "This document covers the complete architecture of the Garmin sync system, "
    "the problems encountered during setup, the fixes applied, and a step-by-step "
    "troubleshooting guide for future engineers.", BODY))
story.append(PageBreak())

# ═══════════════════════════════════════════════════════════════════════════════
# 1. PROJECT OVERVIEW
# ═══════════════════════════════════════════════════════════════════════════════
story.append(h1("1. Project Overview"))
story.append(HR())
story.append(body(
    "Workout AI App is a personal fitness dashboard built with <b>Next.js</b> (deployed on "
    "<b>Vercel</b>) backed by <b>Supabase</b> (PostgreSQL + auth). It pulls health and "
    "activity data from a user's <b>Garmin Connect</b> account and displays readiness scores, "
    "sleep, steps, HRV, body battery, stress, and workout activities."))
story.append(SP(8))

story.append(h2("Tech Stack"))
stack_data = [
    ["Layer", "Technology", "Purpose"],
    ["Frontend", "Next.js 14 (App Router)", "Web UI — deployed on Vercel"],
    ["Database", "Supabase (PostgreSQL)", "Stores health data, tokens, user auth"],
    ["Sync Worker", "Python 3.11 (sync_once.py)", "Pulls data from Garmin API into Supabase"],
    ["CI/CD", "GitHub Actions", "Runs the Python sync worker on demand or schedule"],
    ["Garmin Client", "garminconnect 0.3.x", "Python library wrapping Garmin Connect API"],
    ["Auth", "JWT (di_token) + di_refresh_token", "Garmin session tokens stored in Supabase"],
]
story.append(table(stack_data, [3.5*cm, 5.5*cm, 7.5*cm]))

story.append(SP(10))
story.append(h2("How a Sync Works — End to End"))
story.append(body(
    "When the user clicks <b>Sync Now</b> (or when a scheduled cron fires), the following "
    "chain of events occurs:"))
steps = [
    "Browser POSTs to <b>/api/integrations/garmin/sync</b> (Next.js API route on Vercel)",
    "The API route authenticates the user via Supabase, then calls the <b>GitHub API</b> to dispatch the <b>garmin-sync.yml</b> workflow",
    "GitHub Actions spins up an Ubuntu runner and runs <b>garmin-sync/sync_once.py</b>",
    "sync_once.py loads <b>garmin_tokens.json</b> from Supabase table <b>garmin_token_store</b>",
    "It authenticates to Garmin Connect using the stored JWT tokens (no password needed)",
    "It pulls today's daily summary, HRV, sleep, body battery, and recent activities",
    "Data is upserted into Supabase: <b>daily_health_metrics</b> and <b>garmin_activities</b>",
    "The refreshed tokens are saved back to <b>garmin_token_store</b>",
    "The <b>provider_connections</b> row is updated with status=connected and last_successful_sync_at",
    "Vercel re-renders the dashboard with the fresh data",
]
story.extend(bullet(steps))
story.append(PageBreak())

# ═══════════════════════════════════════════════════════════════════════════════
# 2. KEY FILES
# ═══════════════════════════════════════════════════════════════════════════════
story.append(h1("2. Key Files & Their Roles"))
story.append(HR())

files_data = [
    ["File Path", "Role"],
    ["garmin-sync/sync_once.py", "Main Python sync worker. Authenticates to Garmin, pulls data, writes to Supabase."],
    ["garmin-sync/bootstrap_tokens.py", "One-off local script to generate fresh Garmin tokens and upload to Supabase."],
    ["garmin-sync/requirements.txt", "Python dependencies. Must stay on garminconnect>=0.3.2,<0.4.0."],
    [".github/workflows/garmin-sync.yml", "GitHub Actions workflow. Triggered by web app or manually. Runs sync_once.py."],
    ["app/api/integrations/garmin/sync/route.ts", "Next.js API route. Triggers GitHub Actions dispatch when user clicks Sync Now."],
    ["app/api/integrations/garmin/connect/route.ts", "Next.js API route. Called on first connection to set up Garmin integration."],
    ["components/garmin/garmin-status-card.tsx", "UI component. Shows sync status, last sync time, recent activities, Sync Now button."],
]
story.append(table(files_data, [7*cm, 9.5*cm]))

story.append(SP(12))
story.append(h2("Environment Variables"))
story.append(body("These must be set in Vercel (for the web app) and GitHub Secrets (for Actions):"))

env_data = [
    ["Variable", "Where Used", "Description"],
    ["SUPABASE_URL", "Vercel + GitHub", "Your Supabase project URL (same as NEXT_PUBLIC_SUPABASE_URL)"],
    ["SUPABASE_SERVICE_ROLE_KEY", "Vercel + GitHub", "Service role key — full DB access, keep secret"],
    ["SUPABASE_USER_ID", "GitHub Secrets", "The UUID of your Supabase auth user"],
    ["GARMIN_EMAIL", "GitHub Secrets", "Garmin account email (used only for bootstrap/fallback)"],
    ["GARMIN_PASSWORD", "GitHub Secrets", "Garmin account password (used only for bootstrap/fallback)"],
    ["GITHUB_TOKEN", "Vercel", "Personal access token — allows Vercel to dispatch GitHub Actions"],
    ["GITHUB_OWNER", "Vercel", "GitHub username (e.g. kmfry1979)"],
    ["GITHUB_REPO", "Vercel", "GitHub repo name (e.g. workout-ai-app)"],
    ["GARMINTOKENS", "GitHub Actions", "Set to /tmp/garmin_tokens in the workflow — temp token directory"],
]
story.append(table(env_data, [5*cm, 3.5*cm, 8*cm]))
story.append(PageBreak())

# ═══════════════════════════════════════════════════════════════════════════════
# 3. SUPABASE DATABASE SCHEMA
# ═══════════════════════════════════════════════════════════════════════════════
story.append(h1("3. Supabase Database Tables"))
story.append(HR())

story.append(h2("garmin_token_store"))
story.append(body("Stores the Garmin JWT session tokens. One row per user. Updated after every successful sync."))
tok_data = [
    ["Column", "Type", "Description"],
    ["user_id", "UUID (PK)", "Supabase auth user UUID"],
    ["token_files", "JSONB", "JSON object — key is 'garmin_tokens.json', value is the full JWT token string from api.client.dumps()"],
    ["updated_at", "TIMESTAMPTZ", "Timestamp of last token update"],
]
story.append(table(tok_data, [3.5*cm, 3.5*cm, 9.5*cm]))
story.append(note(
    "In the old v0.2.x system, token_files had two keys: 'oauth1_token.json' and 'oauth2_token.json'. "
    "In v0.3.x it has a single key: 'garmin_tokens.json'. If you see the old keys in Supabase, "
    "the tokens are from before the upgrade — run bootstrap_tokens.py to replace them."))

story.append(SP(10))
story.append(h2("provider_connections"))
story.append(body("Tracks the state of each user's Garmin integration. One row per user per provider."))
pc_data = [
    ["Column", "Description"],
    ["user_id", "Supabase user UUID"],
    ["provider_type", "Always 'garmin' for this integration"],
    ["status", "'connecting' | 'syncing' | 'connected' | 'error'"],
    ["external_account_id", "Full name from Garmin profile (e.g. 'Kelvin')"],
    ["last_sync_at", "Timestamp of most recent sync attempt"],
    ["last_successful_sync_at", "Timestamp of last successful sync"],
    ["last_error", "Error message if status = 'error' — check this first when debugging"],
    ["backfill_complete", "Boolean — true once initial data load is done"],
]
story.append(table(pc_data, [5.5*cm, 11*cm]))

story.append(SP(10))
story.append(h2("daily_health_metrics"))
story.append(body(
    "One row per user per calendar date. Stores everything synced from Garmin's daily summary "
    "API including steps, calories, sleep, HRV, body battery, stress, SpO2, and respiration. "
    "Upserted on (connection_id, metric_date) — safe to run multiple times."))

story.append(SP(10))
story.append(h2("garmin_activities"))
story.append(body(
    "One row per activity (run, cycle, gym session etc). Stores duration, distance, heart rate, "
    "training effect, and the full raw payload from Garmin. "
    "Upserted on (connection_id, provider_activity_id)."))
story.append(PageBreak())

# ═══════════════════════════════════════════════════════════════════════════════
# 4. PROBLEMS ENCOUNTERED AND FIXES
# ═══════════════════════════════════════════════════════════════════════════════
story.append(h1("4. Problems Encountered & Fixes Applied"))
story.append(HR())

# Problem 1
story.append(KeepTogether([
    h2("Problem 1 — Local Machine IP Rate Limited (429)"),
    body(
        "Running sync_once.py or bootstrap_tokens.py from a home PC caused Garmin's SSO "
        "endpoint to return 429 Too Many Requests. Garmin applies rate limits per IP and "
        "per account. Repeated failed login attempts (from expired tokens triggering "
        "password fallback) escalated the lockout."),
    h3("Error Seen"),
    code("requests.exceptions.HTTPError: 429 Client Error: Too Many Requests for url:\nhttps://sso.garmin.com/sso/signin?..."),
    h3("Fix"),
    body(
        "Disabled password fallback in CI entirely (commit: 'Disable password login fallback "
        "in CI to prevent re-triggering Garmin rate limit'). Local token refresh was done via "
        "Google Colab (clean IP) after waiting 24 hours for the account lockout to clear."),
    SP(4),
]))

# Problem 2
story.append(KeepTogether([
    h2("Problem 2 — OAuth Tokens in Supabase Were Expired"),
    body(
        "The garminconnect v0.2.x library stored two token files: oauth1_token.json and "
        "oauth2_token.json. These tokens expired and when garth tried to use them, Garmin "
        "returned an empty response body causing a JSONDecodeError."),
    h3("Error Seen"),
    code("DEBUG exc type: JSONDecodeError, str: Expecting value: line 1 column 1 (char 0)\nToken login failed (...), falling back to password login."),
    h3("Fix"),
    body(
        "Migrated to garminconnect v0.3.x which uses a completely different auth flow — "
        "Garmin's new React app endpoint (/gc-api) with JWT tokens. Fresh tokens were "
        "generated via Google Colab and uploaded to Supabase."),
    SP(4),
]))

# Problem 3
story.append(KeepTogether([
    h2("Problem 3 — garminconnect v0.2.x SSO Permanently Blocked"),
    body(
        "Even on clean IPs (Google Colab), the old v0.2.x library's SSO-based login "
        "continued returning 429. The sso.garmin.com endpoint was rate-limited at both "
        "IP and account level."),
    h3("Error Seen"),
    code("GarthHTTPError: Error in request: 429 Client Error: Too Many Requests for url:\nhttps://sso.garmin.com/sso/signin?..."),
    h3("Root Cause"),
    body(
        "Garmin rebuilt their web app in React and now uses a different backend endpoint "
        "(/gc-api). The old sso.garmin.com SSO flow used by garth/garminconnect v0.2.x is "
        "being deprecated and is heavily rate-limited."),
    h3("Fix"),
    body(
        "Upgraded garminconnect from 0.2.x to 0.3.2. The new version implements Garmin's "
        "React app auth flow using JWT tokens (di_token + di_refresh_token) stored in a "
        "single garmin_tokens.json file via api.client.dumps()/loads()."),
    SP(4),
]))

# Problem 4
story.append(KeepTogether([
    h2("Problem 4 — GitHub Actions Running Old Code After Upgrade"),
    body(
        "After updating sync_once.py to v0.3.x, the sync still failed because the changes "
        "had not been committed and pushed to the main branch. GitHub Actions pulls code "
        "from main, so it was still running the old v0.2.x code that looked for "
        "oauth1_token.json — which no longer existed in Supabase."),
    h3("Error Seen"),
    code("RuntimeError: No valid tokens found in Supabase and password login is disabled in CI.\nRun bootstrap_tokens.py locally to upload fresh tokens to Supabase."),
    h3("Fix"),
    body(
        "Committed and merged the three changed files to main: "
        "garmin-sync/sync_once.py, garmin-sync/requirements.txt, garmin-sync/bootstrap_tokens.py."),
]))
story.append(PageBreak())

# ═══════════════════════════════════════════════════════════════════════════════
# 5. GARMINCONNECT V0.3.X — WHAT CHANGED
# ═══════════════════════════════════════════════════════════════════════════════
story.append(h1("5. garminconnect v0.3.x — Key API Changes"))
story.append(HR())

story.append(body(
    "The upgrade from v0.2.x to v0.3.x is a breaking change. The garth library is no longer "
    "used. The new library talks to Garmin's React app backend directly."))

story.append(SP(8))
changes_data = [
    ["Area", "v0.2.x (OLD)", "v0.3.x (NEW — current)"],
    ["Auth endpoint", "sso.garmin.com/sso/signin", "Garmin React app (/gc-api)"],
    ["Token format", "oauth1_token.json + oauth2_token.json", "Single garmin_tokens.json"],
    ["Token library", "garth", "Built-in (no garth dependency)"],
    ["Constructor", "Garmin(email, password)", "Garmin(email, password, prompt_mfa=fn)"],
    ["Login", "api.login(token_dir_path)", "api.login(tokenstore=token_dir_path)"],
    ["MFA", "Separate resume_login() call", "prompt_mfa callback in constructor"],
    ["Save tokens", "api.garth.dump(path)", "api.client.dumps() — returns JSON string"],
    ["Load tokens", "Write files, then api.login(path)", "Write garmin_tokens.json, then api.login(tokenstore=path)"],
    ["Token TTL", "OAuth tokens (long-lived)", "JWT ~19 hours, refresh token longer"],
]
story.append(table(changes_data, [3*cm, 5*cm, 8.5*cm]))

story.append(SP(10))
story.append(h2("New Login Code Pattern"))
story.append(code(
    "# Token-based login (used in GitHub Actions)\n"
    "api = Garmin(is_cn=False)\n"
    "api.login(tokenstore='/tmp/garmin_tokens')  # reads garmin_tokens.json\n\n"
    "# Password login with MFA (used in bootstrap)\n"
    "api = Garmin(\n"
    "    email='you@example.com',\n"
    "    password='yourpassword',\n"
    "    is_cn=False,\n"
    "    prompt_mfa=lambda: input('Enter MFA code: ')\n"
    ")\n"
    "api.login()\n\n"
    "# Save tokens after login\n"
    "token_content = api.client.dumps()  # returns JSON string\n"
    "# Upload token_content to Supabase garmin_token_store"
))
story.append(PageBreak())

# ═══════════════════════════════════════════════════════════════════════════════
# 6. TROUBLESHOOTING GUIDE
# ═══════════════════════════════════════════════════════════════════════════════
story.append(h1("6. Troubleshooting Guide"))
story.append(HR())
story.append(body(
    "This section covers every failure mode seen so far. When the sync breaks, "
    "start by checking the GitHub Actions log for the failing run."))
story.append(body(
    "Find it at: <b>github.com/kmfry1979/workout-ai-app → Actions → Sync Garmin → "
    "[most recent failed run]</b>"))

story.append(SP(8))

# Scenario 1
story.append(h2("Scenario A — 'No valid tokens found in Supabase'"))
story.append(body("<b>Cause:</b> garmin_tokens.json is missing or empty in the garmin_token_store table."))
story.append(body("<b>Steps to fix:</b>"))
story.extend(bullet([
    "Check Supabase: run SELECT token_files FROM garmin_token_store WHERE user_id = '...' and verify garmin_tokens.json key exists and has content",
    "If missing or empty: follow Section 7 (Token Refresh via Google Colab) to generate fresh tokens",
    "If present but still failing: the token content may be corrupt — check it parses as valid JSON",
]))

story.append(SP(6))
# Scenario 2
story.append(h2("Scenario B — '429 Too Many Requests' (rate limited)"))
story.append(body("<b>Cause:</b> Garmin is rate-limiting the account or IP due to too many failed login attempts."))
story.append(body("<b>Steps to fix:</b>"))
story.extend(bullet([
    "STOP all sync attempts immediately — every failed attempt makes the lockout worse",
    "Wait at least 24 hours (sometimes 48h) before trying again",
    "Log into Garmin Connect in a browser (garminconnect.garmin.com) — this can help clear the lockout",
    "After waiting, run the Google Colab token refresh (Section 7) from a fresh IP",
    "Do NOT trigger the web app sync or GitHub Actions during the wait period",
]))
story.append(warn(
    "NEVER run bootstrap_tokens.py from your home PC if you have already been rate-limited. "
    "Use Google Colab or a VPN to get a clean IP."))

story.append(SP(6))
# Scenario 3
story.append(h2("Scenario C — 'Token login failed in CI' with JSONDecodeError"))
story.append(body(
    "<b>Cause:</b> The JWT access token (di_token) has expired and the refresh token failed. "
    "The di_token has a TTL of ~19 hours. If the refresh token is also expired, "
    "a full re-login is needed."))
story.append(body("<b>Steps to fix:</b>"))
story.extend(bullet([
    "Run the Google Colab token refresh (Section 7) to generate and upload fresh tokens",
    "The di_refresh_token is longer-lived but can expire if not used for a long time",
    "After uploading fresh tokens, trigger Sync Now from the web app",
]))

story.append(SP(6))
# Scenario 4
story.append(h2("Scenario D — Sync succeeds but no new data in the dashboard"))
story.append(body("<b>Possible causes:</b>"))
story.extend(bullet([
    "GARMIN_DAYS_BACK is set to 1 (default) — only today's data is synced. Check if today's Garmin data exists on your watch/phone",
    "Check the garmin_activities and daily_health_metrics tables in Supabase directly",
    "Check provider_connections.last_successful_sync_at — if it updated, the sync did run",
    "Garmin's API sometimes returns empty data for the current day if not enough time has passed since your last activity sync from the watch",
]))

story.append(SP(6))
# Scenario 5
story.append(h2("Scenario E — GitHub Actions workflow not being triggered"))
story.append(body("<b>Cause:</b> The Vercel environment variables for GitHub are missing or wrong."))
story.extend(bullet([
    "Check Vercel env vars: GITHUB_TOKEN, GITHUB_OWNER (kmfry1979), GITHUB_REPO (workout-ai-app)",
    "Check the GitHub Personal Access Token has 'workflow' scope (repo scope alone is not enough)",
    "Check the Next.js API route logs in Vercel for the specific dispatch error",
    "Verify the workflow file name matches: .github/workflows/garmin-sync.yml",
]))
story.append(PageBreak())

# ═══════════════════════════════════════════════════════════════════════════════
# 7. TOKEN REFRESH VIA GOOGLE COLAB
# ═══════════════════════════════════════════════════════════════════════════════
story.append(h1("7. Refreshing Tokens via Google Colab"))
story.append(HR())
story.append(body(
    "Use this process whenever you need to generate fresh Garmin tokens. "
    "Google Colab uses Google's IP addresses which are not rate-limited by Garmin."))
story.append(note(
    "You only need to do this when tokens have expired and the automated refresh fails. "
    "Under normal operation, sync_once.py refreshes and saves tokens automatically after each sync."))

story.append(SP(6))
story.append(h2("Step 1 — Open Google Colab"))
story.append(body("Go to colab.research.google.com and create a new notebook."))

story.append(h2("Step 2 — Install Dependencies (Cell 1)"))
story.append(code('!pip install "garminconnect==0.3.2" requests'))

story.append(h2("Step 3 — Login to Garmin (Cell 2)"))
story.append(code(
    "import os\n"
    "from garminconnect import Garmin\n\n"
    "GARMIN_EMAIL    = 'your-garmin-email@example.com'\n"
    "GARMIN_PASSWORD = 'your-garmin-password'\n\n"
    "os.environ.pop('GARMINTOKENS', None)\n\n"
    "def mfa_prompt():\n"
    "    return input('Enter your Garmin MFA code: ')\n\n"
    "api = Garmin(\n"
    "    email=GARMIN_EMAIL,\n"
    "    password=GARMIN_PASSWORD,\n"
    "    is_cn=False,\n"
    "    prompt_mfa=mfa_prompt\n"
    ")\n"
    "api.login()\n"
    "print('Login successful!')\n"
    "print('Full name:', api.get_full_name())"
))
story.append(body("When it pauses asking for an MFA code, check your email or authenticator app."))

story.append(h2("Step 4 — Upload Tokens to Supabase (Cell 3)"))
story.append(code(
    "import json, requests\n\n"
    "SUPABASE_URL     = 'https://your-project.supabase.co'  # NEXT_PUBLIC_SUPABASE_URL\n"
    "SUPABASE_KEY     = 'eyJ...'                            # SUPABASE_SERVICE_ROLE_KEY\n"
    "SUPABASE_USER_ID = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'  # SUPABASE_USER_ID\n\n"
    "tokens_str = api.client.dumps()\n"
    "print(f'Token size: {len(tokens_str)} bytes')\n\n"
    "resp = requests.post(\n"
    "    f'{SUPABASE_URL}/rest/v1/garmin_token_store',\n"
    "    headers={\n"
    "        'apikey': SUPABASE_KEY,\n"
    "        'Authorization': f'Bearer {SUPABASE_KEY}',\n"
    "        'Content-Type': 'application/json',\n"
    "        'Prefer': 'resolution=merge-duplicates',\n"
    "    },\n"
    "    params={'on_conflict': 'user_id'},\n"
    "    json={'user_id': SUPABASE_USER_ID,\n"
    "          'token_files': {'garmin_tokens.json': tokens_str}},\n"
    "    timeout=15,\n"
    ")\n"
    "print('HTTP', resp.status_code)\n"
    "# Expect: HTTP 200"
))
story.append(body("Once you see <b>HTTP 200</b>, go to your web app and click <b>Sync Now</b>."))
story.append(PageBreak())

# ═══════════════════════════════════════════════════════════════════════════════
# 8. SCHEDULED SYNC
# ═══════════════════════════════════════════════════════════════════════════════
story.append(h1("8. Enabling Scheduled Automatic Sync"))
story.append(HR())
story.append(body(
    "The cron schedule in garmin-sync.yml is currently commented out as a precaution "
    "after the rate-limiting incident. Once the sync has been stable for a few days, "
    "re-enable it by editing the workflow file."))

story.append(SP(8))
story.append(h2("How to Re-enable"))
story.append(body("Edit <b>.github/workflows/garmin-sync.yml</b> and uncomment the schedule block:"))
story.append(code(
    "on:\n"
    "  workflow_dispatch:\n"
    "    inputs:\n"
    "      ...\n"
    "  schedule:\n"
    "    - cron: '0 6 * * *'   # 6am UTC daily — adjust to suit your timezone"
))
story.append(note(
    "Choose a time when your Garmin watch will have already synced the previous night's "
    "sleep data (typically early morning). The default GARMIN_DAYS_BACK=1 only syncs today, "
    "so if the cron runs too early some data may be missing — run it 30-60 minutes after "
    "you typically wake up and sync your watch."))

story.append(SP(10))
story.append(h2("Rate Limit Best Practices"))
story.extend(bullet([
    "Run the scheduled sync no more than once per day",
    "Never schedule more frequent runs — Garmin will rate-limit the account again",
    "The di_token refreshes automatically on each sync, so tokens will stay fresh",
    "If a scheduled run fails 3 days in a row, disable the schedule and investigate before re-enabling",
]))

story.append(PageBreak())

# ═══════════════════════════════════════════════════════════════════════════════
# 9. QUICK REFERENCE
# ═══════════════════════════════════════════════════════════════════════════════
story.append(h1("9. Quick Reference Card"))
story.append(HR())

story.append(h2("Supabase Diagnostic Queries"))
story.append(code(
    "-- Check token freshness\n"
    "SELECT user_id, updated_at,\n"
    "       jsonb_object_keys(token_files) AS token_keys\n"
    "FROM garmin_token_store;\n\n"
    "-- Check sync status\n"
    "SELECT status, last_sync_at, last_successful_sync_at, last_error\n"
    "FROM provider_connections\n"
    "WHERE provider_type = 'garmin';\n\n"
    "-- Check recent health data\n"
    "SELECT metric_date, steps, sleep_minutes, body_battery, hrv_nightly_avg\n"
    "FROM daily_health_metrics\n"
    "ORDER BY metric_date DESC\n"
    "LIMIT 7;\n\n"
    "-- Check recent activities\n"
    "SELECT activity_type, start_time, duration_sec, distance_m\n"
    "FROM garmin_activities\n"
    "ORDER BY start_time DESC\n"
    "LIMIT 10;"
))

story.append(SP(10))
story.append(h2("Useful Links"))
links_data = [
    ["Resource", "URL"],
    ["GitHub Repo", "github.com/kmfry1979/workout-ai-app"],
    ["GitHub Actions", "github.com/kmfry1979/workout-ai-app/actions"],
    ["Supabase Dashboard", "supabase.com/dashboard"],
    ["Vercel Dashboard", "vercel.com/dashboard"],
    ["Garmin Connect", "connect.garmin.com"],
    ["garminconnect releases", "github.com/cyberjunky/python-garminconnect/releases"],
    ["garminconnect issues", "github.com/cyberjunky/python-garminconnect/issues"],
    ["Google Colab", "colab.research.google.com"],
]
story.append(table(links_data, [5*cm, 11.5*cm]))

story.append(SP(10))
story.append(h2("Commit History — Key Fixes"))
commits_data = [
    ["Commit Message", "What it Fixed"],
    ["Upgrade garminconnect to v0.3.x with JWT-based auth", "Core migration to new auth flow, new token format"],
    ["Disable password login fallback in CI", "Stopped CI from wasting rate limit budget on failed password attempts"],
    ["Fix FileNotFoundError in password login path", "Unset GARMINTOKENS so garminconnect uses default path"],
    ["Fix return_on_mfa TypeError and empty token JSONDecodeError", "Caught edge cases in v0.2.x token loading"],
    ["Explicitly pin garth dependency", "Fixed ModuleNotFoundError when garth wasn't installed"],
]
story.append(table(commits_data, [8*cm, 8.5*cm]))

# Build
class DarkBackground:
    def __init__(self, is_cover=False):
        self.is_cover = is_cover
    def __call__(self, canvas, doc):
        if self.is_cover:
            cover_page_bg(canvas, doc)
        else:
            normal_page_bg(canvas, doc)

doc.build(
    story,
    onFirstPage=cover_page_bg,
    onLaterPages=normal_page_bg,
)
print(f"PDF written to: {OUTPUT}")
