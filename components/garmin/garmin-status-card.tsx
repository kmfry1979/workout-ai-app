import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function GarminStatusCard() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // Get connection
  const { data: connection } = await supabase
    .from("provider_connections")
    .select("status,last_sync_at,last_successful_sync_at,last_error")
    .eq("user_id", user.id)
    .eq("provider_type", "garmin")
    .maybeSingle();

  // Get recent Garmin activities
  const { data: activities } = await supabase
    .from("garmin_activities")
    .select("id,activity_type,start_time,duration_sec,distance_m,calories")
    .eq("user_id", user.id)
    .order("start_time", { ascending: false })
    .limit(5);

  return (
    <div className="border rounded-xl p-4 space-y-4">
      <h2 className="text-lg font-semibold">Garmin Integration</h2>

      {/* Buttons */}
      <div className="flex gap-2">
        <form action="/api/integrations/garmin/connect" method="post">
          <button className="px-3 py-2 border rounded-lg">
            Connect Garmin
          </button>
        </form>

        <form action="/api/integrations/garmin/sync" method="post">
          <button className="px-3 py-2 bg-black text-white rounded-lg">
            Sync Now
          </button>
        </form>
      </div>

      {/* Status */}
      <div className="text-sm space-y-1">
        <p>Status: {connection?.status ?? "not connected"}</p>
        <p>
          Last Sync:{" "}
          {connection?.last_successful_sync_at ??
            connection?.last_sync_at ??
            "never"}
        </p>
        {connection?.last_error && (
          <p className="text-red-500">Error: {connection.last_error}</p>
        )}
      </div>

      {/* Activities */}
      <div>
        <h3 className="font-medium">Recent Activities</h3>

        <div className="space-y-2 mt-2">
          {(activities ?? []).map((a) => (
            <div key={a.id} className="border p-2 rounded-lg text-sm">
              <div>{a.activity_type}</div>
              <div>
                {a.start_time
                  ? new Date(a.start_time).toLocaleString()
                  : "Unknown time"}
              </div>
              <div>
                {a.duration_sec
                  ? `${Math.round(a.duration_sec / 60)} min`
                  : ""}
                {a.distance_m ? ` • ${a.distance_m}m` : ""}
                {a.calories ? ` • ${a.calories} cal` : ""}
              </div>
            </div>
          ))}

          {(activities ?? []).length === 0 && (
            <p className="text-gray-500 text-sm">
              No Garmin data yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}