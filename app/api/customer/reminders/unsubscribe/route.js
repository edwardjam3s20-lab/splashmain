// app/api/customer/reminders/unsubscribe/route.js
// POST — remove a customer's push subscription

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/session'

// SECURITY/BUGFIX: this used to be a single hardcoded string
// (CUSTOMER_APP_ORIGIN || the old splashpass-react.vercel.app URL), so it
// always echoed back one fixed value regardless of which origin actually
// made the request. Once the customer app moved to app.splashpass.site,
// every request from there got a mismatched Access-Control-Allow-Origin
// and the browser blocked it. Mirrors the OPERATOR_REACT_ORIGINS allowlist
// pattern in middleware.js and the fix already applied in
// api/auth/login/route.js: check the request's Origin against a known
// set, and only echo it back if it's on the list.
const CUSTOMER_APP_ORIGINS = new Set([
  'http://localhost:5173',
  'https://splashpass-react.vercel.app',
  'https://splashpass.site',
  'https://www.splashpass.site',
  'https://app.splashpass.site',
])

function corsHeaders(origin) {
  const allowOrigin = CUSTOMER_APP_ORIGINS.has(origin) ? origin : ''
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true',
    // Multiple origins share this route, so the response MUST vary by
    // Origin -- otherwise a CDN/edge cache can serve one origin's
    // response back to a different origin.
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
  }
}

export async function OPTIONS(request) {
  const origin = request.headers.get('origin') || ''

  return new NextResponse(null, { status: 200, headers: corsHeaders(origin) })
}

export async function POST(request) {
  const origin = request.headers.get('origin') || ''

  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401, headers: corsHeaders(origin) })
  }

  const body = await request.json().catch(() => null)
  if (!body?.endpoint) {
    return NextResponse.json({ error: 'endpoint is required' }, { status: 400, headers: corsHeaders(origin) })
  }

  const supabase = getSupabaseAdmin()
  const { error } = await supabase
    .from('customer_push_subscriptions')
    .delete()
    .eq('endpoint', body.endpoint)
    .eq('user_email', session.email)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders(origin) })
  }

  return NextResponse.json({ ok: true }, { headers: corsHeaders(origin) })
}
