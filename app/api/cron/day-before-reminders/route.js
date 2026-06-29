// app/api/cron/day-before-reminders/route.js
// GET — finds tomorrow's accepted/confirmed bookings and sends a
// day-before push reminder. Triggered once daily by Vercel's native
// cron (see vercel.json) — Hobby plan allows daily cron natively, so
// this one doesn't need the external scheduler the 30-min reminder does.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { sendPushToCustomer } from '@/lib/push'

function requireCronAuth(request) {
  // Vercel automatically sends CRON_SECRET as a Bearer token for its own
  // native cron invocations — see Vercel's cron docs. This check rejects
  // anyone else hitting this public URL directly.
  const authHeader = request.headers.get('authorization')
  const expected = process.env.CRON_SECRET
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return false
  }
  return true
}

export async function GET(request) {
  if (!requireCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getSupabaseAdmin()

  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('id, user_email, location, date, time, service_name')
    .eq('date', tomorrow)
    .in('status', ['accepted', 'confirmed'])
    .eq('day_before_reminder_sent', false)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  let sent = 0
  for (const b of bookings || []) {
    await sendPushToCustomer(b.user_email, {
      title: 'Wash tomorrow',
      body: `Reminder: your ${b.service_name || 'wash'} at ${b.location} is tomorrow at ${b.time}.`,
      bookingId: b.id,
      url: '/bookings',
    })
    await supabase.from('bookings').update({ day_before_reminder_sent: true }).eq('id', b.id)
    sent++
  }

  return NextResponse.json({ ok: true, checked: bookings?.length || 0, sent })
}
