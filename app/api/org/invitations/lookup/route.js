// app/api/org/invitations/lookup/route.js
// GET — public, unauthenticated. Given a raw invite token (from the email
// link), returns just enough to render "You've been invited to join X as
// a Y" before the person has even logged in or created an account. Never
// returns token_hash or anything else sensitive.

import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import { orgCorsHeaders } from '@/lib/orgCors'

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

export async function OPTIONS(request) {
  const origin = request.headers.get('origin') || ''
  return new NextResponse(null, { status: 200, headers: orgCorsHeaders(origin) })
}

export async function GET(request) {
  const origin = request.headers.get('origin') || ''
  const token = new URL(request.url).searchParams.get('token')

  if (!token) {
    return NextResponse.json({ error: 'Invitation token required.' }, { status: 400, headers: orgCorsHeaders(origin) })
  }

  const supabase = getSupabaseAdmin()
  const { data: invitation, error } = await supabase
    .from('invitations')
    .select('id, email, role, status, expires_at, organization:organizations(name)')
    .eq('token_hash', hashToken(token))
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: 'Could not look up invitation.' }, { status: 500, headers: orgCorsHeaders(origin) })
  }
  if (!invitation) {
    return NextResponse.json({ error: 'This invitation link is invalid.' }, { status: 404, headers: orgCorsHeaders(origin) })
  }
  if (invitation.status !== 'pending') {
    return NextResponse.json({ error: `This invitation has already been ${invitation.status}.` }, { status: 409, headers: orgCorsHeaders(origin) })
  }
  if (new Date() > new Date(invitation.expires_at)) {
    return NextResponse.json({ error: 'This invitation has expired.' }, { status: 409, headers: orgCorsHeaders(origin) })
  }

  return NextResponse.json({
    email: invitation.email,
    role: invitation.role,
    organization_name: invitation.organization?.name || 'a business',
  }, { headers: orgCorsHeaders(origin) })
}
