// app/api/org/auth/logout/route.js
import { NextResponse } from 'next/server'
import { clearOrgSessionCookie } from '@/lib/orgSession'
import { orgCorsHeaders } from '@/lib/orgCors'

export async function OPTIONS(request) {
  const origin = request.headers.get('origin') || ''
  return new NextResponse(null, { status: 200, headers: orgCorsHeaders(origin) })
}

export async function POST(request) {
  const origin = request.headers.get('origin') || ''
  const res = NextResponse.json({ success: true }, { headers: orgCorsHeaders(origin) })
  clearOrgSessionCookie(res)
  return res
}
