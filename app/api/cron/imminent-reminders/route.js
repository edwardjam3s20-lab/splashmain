// app/api/cron/imminent-reminders/route.js
// GET — finds bookings 25-35 minutes from now and sends a push reminder.
// Called every 5 minutes by an EXTERNAL scheduler (cron-job.org), not
// Vercel's own cron — Vercel Hobby only allows daily-frequency native
// cron, which can't support a 30-minutes-before reminder on its own.
//
// The 25-35 min window (not an exact 30) exists because the external
// scheduler's own timing has some slop, and a same-day booking's exact
// minute might fall between two 5-minute-apart invocations otherwise.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { sendPushToCustomer } from '@/lib/push'

function requireCronAuth(request) {
  // cron-job.org lets you configure a custom header per job — set it to
  // send "Authorization: Bearer <CRON_SECRET>" the same way Vercel's own
  // cron does, so this route can use one shared auth check regardless of
  // which scheduler is calling it.
  const authHeader = request.headers.get('authorization')
  const expected = process.env.CRON_SECRET
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return false
  }
  return true
}

function parseSlotDateTime(date, time) {
  const match = String(time).match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (!match) return null
  const [, hStr, mStr, ampm] = match
  let h = parseInt(hStr, 10)
  if (ampm.toUpperCase() === 'PM' && h !== 12) h += 12
  if (ampm.toUpperCase() === 'AM' && h === 12) h = 0
  const d = new Date(date)
  d.setHours(h, parseInt(mStr, 10), 0, 0)
  return d
}

export async function GET(request) {
  if (!requireCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getSupabaseAdmin()
  const today = new Date().toISOString().split('T')[0]

  // Only need to look at today's bookings — anything "30 minutes away"
  // is necessarily today (this app has no overnight-spanning bookings).
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('id, user_email, location, date, time, service_name')
    .eq('date', today)
    .in('status', ['accepted', 'confirmed'])
    .eq('imminent_reminder_sent', false)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const now = Date.now()
  const due = (bookings || []).filter((b) => {
    const slot = parseSlotDateTime(b.date, b.time)
    if (!slot) return false
    const minutesAway = (slot.getTime() - now) / 60000
    return minutesAway >= 25 && minutesAway <= 35
  })

  let sent = 0
  for (const b of due) {
    await sendPushToCustomer(b.user_email, {
      title: 'Wash starting soon',
      body: `Your ${b.service_name || 'wash'} at ${b.location} starts at ${b.time} — see you soon!`,
      bookingId: b.id,
      url: '/bookings',
    })
    await supabase.from('bookings').update({ imminent_reminder_sent: true }).eq('id', b.id)
    sent++
  }

  return NextResponse.json({ ok: true, checked: bookings?.length || 0, sent })
}
