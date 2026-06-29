// app/api/auth/logout/route.js
// POST — clear the session cookie

import { NextResponse } from 'next/server'
import { clearSessionCookie } from '@/lib/session'

const ALLOWED_ORIGIN = process.env.CUSTOMER_APP_ORIGIN || 'https://splashpass-react-poc.vercel.app'

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true',
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders() })
}

export async function POST() {
  const res = NextResponse.json({ ok: true }, { headers: corsHeaders() })
  clearSessionCookie(res)
  return res
}
