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

const ALLOWED_ORIGIN = process.env.CUSTOMER_APP_ORIGIN || 'https://splashpass-react-poc.vercel.app'

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true',
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders() })
}

export async function GET() {
  const session = await getSession()
  if (!session?.email) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401, headers: corsHeaders() })
  }

  const supabase = getSupabaseAdmin()
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('email', session.email)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders() })
  }
  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404, headers: corsHeaders() })
  }

  delete profile.password
  return NextResponse.json({ profile }, { headers: corsHeaders() })
}
