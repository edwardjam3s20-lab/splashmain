/**
 * Applies the operator -> org migration for the 3 operators confirmed via
 * migration-report.json on 2026-07-28:
 *   - Kassim Mohamed   (Latest Car Wash)          — existing washpoint
 *   - Hussein Musa     (Mombasa Raha Car Wash...) — existing washpoint
 *   - Ruth Kamau       (Roy Car Wash Autospares & Garage) — existing
 *     washpoint. Earlier passes of this script mistakenly assumed no
 *     washpoint existed for her — the dry-run report's name match used
 *     "roy carwash" as one word, but the real row is named "Roy Car Wash
 *     Autospares & Garage" (space-separated), so it never matched.
 *     Confirmed directly in Admin + a fresh SQL check: id
 *     8175ce7d-799d-4160-834b-d7d3592ed31e, organization_id was null
 *     before this migration ran.
 *
 * Deliberately NOT a generic bulk-migration script — the operator list
 * below is hardcoded to exactly the 3 rows that were explicitly reviewed
 * and approved. "Pentest Op" is being deleted separately (unrelated
 * cleanup, not a migration). "New Op" (newop_1783065410@splashpass.co.ke)
 * was never addressed and is intentionally NOT in this list — do not add
 * it without a separate decision on whether it's real.
 *
 * This script does NOT touch or delete the legacy `operators` rows. The
 * org tables are additive — legacy /login keeps working exactly as it
 * does today. Only a real cutover (later, per App.tsx's own comment)
 * would retire the old table.
 *
 * DRY RUN BY DEFAULT. Prints the plan and re-checks every guard, writes
 * nothing, unless run with --apply:
 *
 *   node scripts/migrate-operators-to-orgs-apply.mjs            # dry run
 *   node scripts/migrate-operators-to-orgs-apply.mjs --apply    # writes
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const APPLY = process.argv.includes('--apply')

const envPath = resolve(process.cwd(), '.env.local')
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i), l.slice(i + 1)]
    })
)

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const MIGRATIONS = [
  {
    operatorEmail: 'kassimmohamednrb@gmail.com',
    washpoint: { mode: 'existing', id: '48434dc9-a0ea-4004-83bc-6b96ef7bd2b6', name: 'Latest Car Wash' },
  },
  {
    operatorEmail: 'husseinmusa003@gmail.com',
    washpoint: { mode: 'existing', id: '5ac98153-d70a-4ee5-8dc2-104125b7f12b', name: 'Mombasa Raha Car Wash and Apartments' },
  },
  {
    operatorEmail: 'ruthkamau12.rk@gmail.com',
    washpoint: { mode: 'existing', id: '8175ce7d-799d-4160-834b-d7d3592ed31e', name: 'Roy Car Wash Autospares & Garage' },
  },
]

async function migrateOne({ operatorEmail, washpoint }) {
  const log = (msg) => console.log(`[${operatorEmail}] ${msg}`)

  // Re-fetch fresh — don't trust the dry-run snapshot, time has passed.
  const { data: op, error: opError } = await supabase
    .from('operators')
    .select('*')
    .eq('email', operatorEmail)
    .maybeSingle()

  if (opError || !op) {
    log(`SKIP — operator not found (${opError?.message || 'no row'})`)
    return { operatorEmail, status: 'skipped', reason: 'operator not found' }
  }

  const { data: existingOrgUser } = await supabase
    .from('organization_users')
    .select('id')
    .eq('email', operatorEmail)
    .maybeSingle()

  if (existingOrgUser) {
    log('SKIP — organization_users already exists for this email (someone got there first).')
    return { operatorEmail, status: 'skipped', reason: 'organization_users already exists' }
  }

  // Resolve or create the washpoint.
  let washPointId = washpoint.id || null
  let washPointRow = null

  if (washpoint.mode === 'existing') {
    const { data: wp, error: wpError } = await supabase
      .from('wash_points')
      .select('id, name, organization_id')
      .eq('id', washpoint.id)
      .maybeSingle()
    if (wpError || !wp) {
      log(`SKIP — expected existing washpoint ${washpoint.id} not found.`)
      return { operatorEmail, status: 'skipped', reason: 'expected washpoint missing' }
    }
    if (wp.organization_id) {
      log(`SKIP — washpoint ${wp.name} already has organization_id ${wp.organization_id}. Someone already migrated it.`)
      return { operatorEmail, status: 'skipped', reason: 'washpoint already org-linked' }
    }
    washPointRow = wp
    washPointId = wp.id
    log(`Using existing washpoint "${wp.name}" (${wp.id}).`)
  } else {
    log(`Will create washpoint "${washpoint.name}" (area/lat/lng: ${washpoint.area ?? 'null'} / ${washpoint.lat ?? 'null'} / ${washpoint.lng ?? 'null'} — fill in from Admin later if left null).`)
    if (APPLY) {
      const { data: newWp, error: wpInsertError } = await supabase
        .from('wash_points')
        .insert({ name: washpoint.name, area: washpoint.area, lat: washpoint.lat, lng: washpoint.lng })
        .select()
        .single()
      if (wpInsertError) {
        log(`FAILED creating washpoint: ${wpInsertError.message}`)
        return { operatorEmail, status: 'failed', reason: `washpoint insert: ${wpInsertError.message}` }
      }
      washPointRow = newWp
      washPointId = newWp.id
      log(`Created washpoint ${newWp.id}.`)
    }
  }

  log(`Plan: organization "${washpoint.name}" (verified) -> organization_users (password carried over as-is, bcrypt) -> organization_members (owner) -> wash_points.organization_id backfill.`)

  if (!APPLY) return { operatorEmail, status: 'dry-run-ok' }

  // --- Actual writes below, only reached with --apply ---

  const { data: organization, error: orgError } = await supabase
    .from('organizations')
    .insert({ name: washpoint.name, verification_status: 'verified' })
    .select()
    .single()

  if (orgError) {
    log(`FAILED creating organization: ${orgError.message}`)
    return { operatorEmail, status: 'failed', reason: `organization insert: ${orgError.message}` }
  }

  const { data: orgUser, error: userError } = await supabase
    .from('organization_users')
    .insert({
      full_name: op.name || washpoint.name,
      email: operatorEmail,
      phone: null,
      password: op.password, // already bcrypt — verified portable in the dry run
      email_verified_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (userError) {
    log(`FAILED creating organization_users, rolling back organization: ${userError.message}`)
    await supabase.from('organizations').delete().eq('id', organization.id)
    return { operatorEmail, status: 'failed', reason: `organization_users insert: ${userError.message}` }
  }

  const { error: memberError } = await supabase
    .from('organization_members')
    .insert({ organization_id: organization.id, user_id: orgUser.id, role: 'owner', status: 'active' })

  if (memberError) {
    log(`FAILED creating organization_members, rolling back: ${memberError.message}`)
    await supabase.from('organization_users').delete().eq('id', orgUser.id)
    await supabase.from('organizations').delete().eq('id', organization.id)
    return { operatorEmail, status: 'failed', reason: `organization_members insert: ${memberError.message}` }
  }

  const { error: wpUpdateError } = await supabase
    .from('wash_points')
    .update({ organization_id: organization.id })
    .eq('id', washPointId)

  if (wpUpdateError) {
    log(`FAILED backfilling wash_points.organization_id — organization and membership were created, this needs a manual fix: ${wpUpdateError.message}`)
    return { operatorEmail, status: 'partial', reason: `wash_points update failed: ${wpUpdateError.message}`, organization_id: organization.id }
  }

  await supabase.from('audit_logs').insert({
    organization_id: organization.id,
    actor_user_id: orgUser.id,
    actor_type: 'system_migration',
    action: 'organization.migrated_from_legacy_operator',
    target_type: 'organization',
    target_id: organization.id,
    metadata: { legacy_operator_id: op.id, legacy_operator_email: operatorEmail },
  })

  log(`DONE — organization ${organization.id}, organization_users ${orgUser.id}.`)
  return { operatorEmail, status: 'applied', organization_id: organization.id }
}

async function main() {
  console.log(APPLY ? 'APPLY MODE — writes will happen.\n' : 'DRY RUN — no writes will happen. Run with --apply to actually migrate.\n')

  const results = []
  for (const m of MIGRATIONS) {
    results.push(await migrateOne(m))
    console.log('')
  }

  console.log('Summary:')
  console.table(results)

  const failures = results.filter((r) => r.status === 'failed' || r.status === 'partial')
  if (failures.length) {
    console.log('\nSome rows need attention — see "failed"/"partial" above.')
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error('Migration run crashed:', err)
  process.exit(1)
})
