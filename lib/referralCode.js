// lib/referralCode.js
// Generates a unique, shareable referral code for a new profile.
// Format: 4 letters from the person's name (or "SPLASH" if unusable) + 4
// random alphanumerics, e.g. "JANE7F2A" — matches the backfill format in
// supabase/010_referrals.sql so old and new codes look the same.

const REFERRAL_BONUS_POINTS = 50

function randomSuffix() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I — avoids
  // ambiguous characters when a code is read aloud or hand-copied.
  let out = ''
  for (let i = 0; i < 4; i++) {
    out += chars[Math.floor(Math.random() * chars.length)]
  }
  return out
}

function namePrefix(name) {
  const letters = String(name || '').replace(/[^a-zA-Z]/g, '').toUpperCase()
  return (letters.slice(0, 4) || 'SPLASH').slice(0, 4)
}

// Retries on the rare collision — the unique constraint in
// 010_referrals.sql is the actual safety net, this just avoids a doomed
// insert in the common case.
export async function generateUniqueReferralCode(supabase, name) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `${namePrefix(name)}${randomSuffix()}`
    const { data } = await supabase
      .from('profiles')
      .select('id')
      .eq('referral_code', candidate)
      .maybeSingle()
    if (!data) return candidate
  }
  // Extremely unlikely fallback — timestamp-derived, still unique enough
  // to insert; the DB constraint would reject a true collision anyway.
  return `SPLSH${Date.now().toString(36).toUpperCase().slice(-6)}`
}

export { REFERRAL_BONUS_POINTS }
