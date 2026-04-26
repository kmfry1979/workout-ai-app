import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

/**
 * GET /api/brain/debug
 * Returns table existence + row counts for the authenticated user.
 * Useful for diagnosing why Brain generates 422.
 */
export async function GET(req: NextRequest) {
  if (!SUPABASE_URL || !SERVICE_KEY)
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 })

  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return NextResponse.json({ error: 'Authorization required' }, { status: 401 })

  const admin = createClient(SUPABASE_URL, SERVICE_KEY)
  const { data: { user }, error: authErr } = await admin.auth.getUser(token)
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const uid = user.id

  // Run all diagnostic queries in parallel
  const [h1, h2, sl, st, ac, wt, di] = await Promise.all([
    admin.from('garmin_daily_health_metrics').select('metric_date', { count: 'exact', head: false })
      .eq('user_id', uid).order('metric_date', { ascending: false }).limit(1),
    admin.from('daily_health_metrics').select('metric_date', { count: 'exact', head: false })
      .eq('user_id', uid).order('metric_date', { ascending: false }).limit(1),
    admin.from('garmin_sleep_data').select('sleep_date', { count: 'exact', head: false })
      .eq('user_id', uid).order('sleep_date', { ascending: false }).limit(1),
    admin.from('garmin_daily_steps').select('step_date', { count: 'exact', head: false })
      .eq('user_id', uid).order('step_date', { ascending: false }).limit(1),
    admin.from('garmin_activities').select('start_time', { count: 'exact', head: false })
      .eq('user_id', uid).order('start_time', { ascending: false }).limit(1),
    admin.from('garmin_weight_snapshots').select('weigh_date', { count: 'exact', head: false })
      .eq('user_id', uid).order('weigh_date', { ascending: false }).limit(1),
    admin.from('daily_insights').select('insight_date', { count: 'exact', head: false })
      .eq('user_id', uid).order('insight_date', { ascending: false }).limit(1),
  ])

  return NextResponse.json({
    user_id: uid,
    tables: {
      garmin_daily_health_metrics: {
        total_rows: h1.count,
        latest_date: (h1.data ?? [])[0]?.metric_date ?? null,
        error: h1.error ? `${h1.error.code}: ${h1.error.message}` : null,
      },
      daily_health_metrics: {
        total_rows: h2.count,
        latest_date: (h2.data ?? [])[0]?.metric_date ?? null,
        error: h2.error ? `${h2.error.code}: ${h2.error.message}` : null,
      },
      garmin_sleep_data: {
        total_rows: sl.count,
        latest_date: (sl.data ?? [])[0]?.sleep_date ?? null,
        error: sl.error ? `${sl.error.code}: ${sl.error.message}` : null,
      },
      garmin_daily_steps: {
        total_rows: st.count,
        latest_date: (st.data ?? [])[0]?.step_date ?? null,
        error: st.error ? `${st.error.code}: ${st.error.message}` : null,
      },
      garmin_activities: {
        total_rows: ac.count,
        latest_date: (ac.data ?? [])[0]?.start_time ?? null,
        error: ac.error ? `${ac.error.code}: ${ac.error.message}` : null,
      },
      garmin_weight_snapshots: {
        total_rows: wt.count,
        latest_date: (wt.data ?? [])[0]?.weigh_date ?? null,
        error: wt.error ? `${wt.error.code}: ${wt.error.message}` : null,
      },
      daily_insights: {
        total_rows: di.count,
        latest_date: (di.data ?? [])[0]?.insight_date ?? null,
        error: di.error ? `${di.error.code}: ${di.error.message}` : null,
      },
    },
  })
}
