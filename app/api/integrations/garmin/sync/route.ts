import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

async function dispatchGarminWorkflow(userId: string, reason: string) {
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
        inputs: {
          user_id: userId,
          reason,
        },
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    console.error("GitHub dispatch failed:", res.status, text);
    throw new Error(`GitHub dispatch failed (${res.status}): ${text}`);
  }
}

export async function POST() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
        last_successful_sync_at: null,
        sync_cursor: null,
        backfill_start_date: null,
        backfill_complete: false,
        last_error: null,
        updated_at: now,
        created_at: now,
      },
      { onConflict: "user_id,provider_type" }
    );

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 400 });
  }

  try {
    await dispatchGarminWorkflow(user.id, "manual");

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

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const message = err?.message ?? "Failed to trigger sync";
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