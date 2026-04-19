import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type DispatchInputs = {
  user_id: string;
  reason: string;
  run_id?: string;
  days_back?: string;
  request_delay?: string;
};

async function dispatchGarminWorkflow(inputs: DispatchInputs) {
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const workflowFile = process.env.GITHUB_WORKFLOW_FILE || "garmin-sync.yml";
  const token = process.env.GITHUB_TOKEN;

  if (!owner || !repo || !token) {
    throw new Error(
      `Missing GitHub env vars: ${[
        !owner ? "GITHUB_OWNER" : null,
        !repo ? "GITHUB_REPO" : null,
        !token ? "GITHUB_TOKEN" : null,
      ]
        .filter(Boolean)
        .join(", ")}`
    );
  }

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowFile}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ref: "main",
        inputs,
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    console.error("GitHub dispatch failed:", res.status, text);
    throw new Error(`GitHub dispatch failed (${res.status}): ${text}`);
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Optional body: { days_back?: number, reason?: string, request_delay?: number }
  let body: { days_back?: number; reason?: string; request_delay?: number } = {};
  try {
    if (req.headers.get("content-length") && req.headers.get("content-length") !== "0") {
      body = await req.json();
    }
  } catch {
    // body is optional; treat as default sync
  }

  const daysBackRaw = Number(body.days_back ?? 1);
  // Cap at 365 days as a safety net — a year of history is plenty.
  const daysBack = Number.isFinite(daysBackRaw) ? Math.max(1, Math.min(365, Math.round(daysBackRaw))) : 1;
  const reason = body.reason ?? (daysBack > 1 ? `manual-backfill-${daysBack}d` : "manual");
  const requestDelayRaw = Number(body.request_delay ?? (daysBack > 30 ? 1.5 : 1.0));
  const requestDelay = Number.isFinite(requestDelayRaw) ? Math.max(0.2, Math.min(5, requestDelayRaw)) : 1.0;

  const runId = randomUUID();
  const now = new Date().toISOString();

  const { error: upsertError } = await supabase
    .from("provider_connections")
    .upsert(
      {
        user_id: user.id,
        provider_type: "garmin",
        status: "syncing",
        external_account_id: null,
        oauth_access_token_enc: null,
        oauth_refresh_token_enc: null,
        token_expires_at: null,
        last_sync_at: now,
        sync_cursor: null,
        backfill_start_date: null,
        backfill_complete: false,
        last_error: null,
        updated_at: now,
        created_at: now,
      },
      {
        onConflict: "user_id,provider_type",
        ignoreDuplicates: false,
      }
    );

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 400 });
  }

  try {
    await dispatchGarminWorkflow({
      user_id: user.id,
      reason,
      run_id: runId,
      days_back: String(daysBack),
      request_delay: String(requestDelay),
    });

    await supabase
      .from("provider_connections")
      .update({
        status: "syncing",
        last_sync_at: now,
        last_error: null,
        updated_at: now,
      })
      .eq("user_id", user.id)
      .eq("provider_type", "garmin");

    return NextResponse.json({ ok: true, run_id: runId, days_back: daysBack });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to trigger sync";
    console.error("Garmin sync trigger failed:", message);

    await supabase
      .from("provider_connections")
      .update({
        status: "error",
        last_error: message,
        updated_at: now,
      })
      .eq("user_id", user.id)
      .eq("provider_type", "garmin");

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
