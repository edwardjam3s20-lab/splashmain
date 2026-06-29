// app/api/auth/register/route.js
// POST — create customer account, set session cookie, return user

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { createSession, setSessionCookie } from '@/lib/session'

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

export async function POST(request) {
  const { name, email, phone, password } = await request.json()

  if (!name || !email || !phone || !password) {
    return NextResponse.json({ error: 'All fields required' }, { status: 400, headers: corsHeaders() })
  }
  if (password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400, headers: corsHeaders() })
  }

  const supabase = getSupabaseAdmin()
  const cleanEmail = email.toLowerCase().trim()

  // Check if account already exists
  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', cleanEmail)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ error: 'Account already exists' }, { status: 409, headers: corsHeaders() })
  }

  // Hash password server-side via pgcrypto RPC
  const { data: hashData, error: hashError } = await supabase.rpc('hash_password', {
    p_password: password,
  })

  if (hashError || !hashData) {
    return NextResponse.json({ error: 'Password hashing failed' }, { status: 500, headers: corsHeaders() })
  }

  const hashedPassword = Array.isArray(hashData) ? hashData[0]?.hash_password : hashData

  if (!hashedPassword) {
    return NextResponse.json({ error: 'Password hashing failed' }, { status: 500, headers: corsHeaders() })
  }

  // Create profile
  const { data: newUsers, error: insertError } = await supabase
    .from('profiles')
    .insert({
      name,
      email:          cleanEmail,
      phone,
      password:       hashedPassword,
      role:           'customer',
      sub_status:     'trial',
      loyalty_points: 0,
      loyalty_tier:   'Bronze',
    })
    .select()

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500, headers: corsHeaders() })
  }

  const user = newUsers[0]
  delete user.password

  // Create JWT session
  const token = await createSession({
    email: user.email,
    name:  user.name,
    role:  user.role,
  })

  const res = NextResponse.json({ ok: true, user }, { headers: corsHeaders() })
  setSessionCookie(res, token)
  return res
}
