// app/api/customer/profile/route.js
// GET — returns the current session's own profile. Always derives the
// email from the verified session, never from a query param — this is
// what actually closes the read-side IDOR the customer app's auth.ts had
// (getUserByEmail(email) previously hit Supabase directly with the anon
// key and no ownership check, so anyone could read anyone's profile by
// guessing/knowing their email). Every call site in the customer app
// already only ever asks for its own currentUser.email, so scoping this
// to "whoever the session says you are" changes nothing for legitimate
// use and closes the gap for everyone else.

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
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

export async function GET(request) {
  const origin = request.headers.get('origin') || ''

  const session = await getSession()
  if (!session?.email) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401, headers: corsHeaders(origin) })
  }

  const supabase = getSupabaseAdmin()
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('email', session.email)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders(origin) })
  }
  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404, headers: corsHeaders(origin) })
  }

  delete profile.password
  return NextResponse.json({ profile }, { headers: corsHeaders(origin) })
}
