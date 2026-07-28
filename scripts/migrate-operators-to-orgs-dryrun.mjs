/**
 * DRY RUN ONLY — no writes to Supabase. Reads the legacy `operators` table
 * and reports how each row would map onto the new org model
 * (organizations / organization_users / organization_members / wash_points
 * .organization_id), plus every case that needs a human decision before
 * anything is applied.
 *
 * Run locally with .env.local present (same convention as
 * scripts/reset-operator-password.mjs):
 *
 *   node scripts/migrate-operators-to-orgs-dryrun.mjs
 *
 * Writes two files next to wherever you run it from:
 *   migration-report.json  — full machine-readable detail
 *   migration-report.md    — human-readable summary
 *
 * There is no --apply flag in this script on purpose. The apply script
 * gets written after this report has been reviewed against real
 * production data — the shape of the conflicts below (not guesses made
 * ahead of time) should decide how each case is handled.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

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

function isBcrypt(hash) {
  return typeof hash === 'string' && hash.trim().startsWith('$2')
}

async function main() {
  const [
    { data: operators, error: opError },
    { data: washPoints, error: wpError },
    { data: orgUsers, error: ouError },
    { data: orgs, error: orgError },
  ] = await Promise.all([
    supabase.from('operators').select('*'),
    supabase.from('wash_points').select('id, name, organization_id'),
    supabase.from('organization_users').select('id, email'),
    supabase.from('organizations').select('id, name'),
  ])

  for (const [label, err] of [
    ['operators', opError], ['wash_points', wpError],
    ['organization_users', ouError], ['organizations', orgError],
  ]) {
    if (err) {
      console.error(`Failed to read ${label}:`, err.message)
      process.exit(1)
    }
  }

  const wpById = new Map(washPoints.map((w) => [w.id, w]))
  const wpByName = new Map(washPoints.map((w) => [w.name?.trim().toLowerCase(), w]))
  const orgUserEmails = new Set(orgUsers.map((u) => u.email?.toLowerCase()))
  const orgNameById = new Map(orgs.map((o) => [o.id, o.name]))

  // Resolve each operator's washpoint the same way lib/loadOperator.js does
  // at runtime: wash_point_id first, fall back to matching wash_point (the
  // legacy name string) against wash_points.name.
  const resolved = operators.map((op) => {
    let washPoint = op.wash_point_id ? wpById.get(op.wash_point_id) : null
    let resolution = washPoint ? 'by_id' : null
    if (!washPoint && op.wash_point) {
      washPoint = wpByName.get(String(op.wash_point).trim().toLowerCase()) || null
      if (washPoint) resolution = 'by_name_fallback'
    }
    return { op, washPoint, resolution }
  })

  const unresolved = resolved.filter((r) => !r.washPoint)
  const resolvedOk = resolved.filter((r) => r.washPoint)

  // Group by resolved washpoint id — more than one operator per washpoint
  // is a real case (the schema allows it) and needs a role decision the
  // data can't answer on its own.
  const byWashPoint = new Map()
  for (const r of resolvedOk) {
    const key = r.washPoint.id
    if (!byWashPoint.has(key)) byWashPoint.set(key, [])
    byWashPoint.get(key).push(r)
  }

  const plan = []      // clean, single-owner migrations
  const multiGroups = [] // washpoints with >1 operator — needs a role call
  const alreadyOrgLinked = [] // wash_point already has organization_id set
  const emailConflicts = [] // operator email already exists in organization_users

  for (const [washPointId, group] of byWashPoint) {
    const washPoint = group[0].washPoint

    if (washPoint.organization_id) {
      for (const r of group) {
        alreadyOrgLinked.push({
          operator_id: r.op.id,
          operator_email: r.op.email,
          wash_point_id: washPointId,
          wash_point_name: washPoint.name,
          existing_organization_id: washPoint.organization_id,
          existing_organization_name: orgNameById.get(washPoint.organization_id) || null,
        })
      }
      continue
    }

    const withEmailConflict = group.filter((r) => orgUserEmails.has(r.op.email?.toLowerCase()))
    const clean = group.filter((r) => !orgUserEmails.has(r.op.email?.toLowerCase()))

    for (const r of withEmailConflict) {
      emailConflicts.push({
        operator_id: r.op.id,
        operator_email: r.op.email,
        wash_point_id: washPointId,
        wash_point_name: washPoint.name,
        reason: 'An organization_users row already exists for this email — likely a separate self-registration. Needs a manual decision on which identity wins before this operator can be linked.',
      })
    }

    if (clean.length === 0) continue

    if (clean.length > 1) {
      multiGroups.push({
        wash_point_id: washPointId,
        wash_point_name: washPoint.name,
        operators: clean.map((r) => ({
          id: r.op.id,
          email: r.op.email,
          name: r.op.name,
          created_at: r.op.created_at,
          password_portable: isBcrypt(r.op.password),
        })),
        note: 'More than one operator resolves to this washpoint. Proposed default below picks the earliest-created operator as owner and the rest as attendant — confirm before applying, this is a business decision the data can\'t make.',
        proposed_owner: [...clean].sort((a, b) => new Date(a.op.created_at || 0) - new Date(b.op.created_at || 0))[0].op.email,
      })
      continue
    }

    const r = clean[0]
    plan.push({
      operator_id: r.op.id,
      operator_email: r.op.email,
      operator_name: r.op.name,
      wash_point_id: washPointId,
      wash_point_name: washPoint.name,
      wash_point_resolution: r.resolution,
      password_portable: isBcrypt(r.op.password),
      proposed: {
        organization_name: washPoint.name,
        organization_verification_status: 'verified', // already a real, operating business
        organization_member_role: 'owner',
        organization_users_email_verified: 'set to now() — administrative migration, not self-verified',
        wash_points_organization_id: '<new organization id>',
      },
    })
  }

  const passwordResetNeeded = [...plan, ...multiGroups.flatMap((g) => g.operators.map((o) => ({ operator_email: o.email, password_portable: o.password_portable })))]
    .filter((r) => r.password_portable === false)

  const report = {
    generated_at: new Date().toISOString(),
    counts: {
      total_operators: operators.length,
      unresolved_wash_point: unresolved.length,
      already_org_linked: alreadyOrgLinked.length,
      email_conflicts: emailConflicts.length,
      clean_single_owner_migrations: plan.length,
      multi_operator_washpoints: multiGroups.length,
      password_needs_reset: passwordResetNeeded.length,
    },
    unresolved_wash_point: unresolved.map((r) => ({
      operator_id: r.op.id,
      operator_email: r.op.email,
      operator_name: r.op.name,
      raw_wash_point_id: r.op.wash_point_id,
      raw_wash_point_name: r.op.wash_point,
      reason: 'Neither wash_point_id nor a name match against wash_points.name resolved. This is the known name-vs-id fragility — these rows need a manual washpoint assignment before they can be migrated.',
    })),
    already_org_linked: alreadyOrgLinked,
    email_conflicts: emailConflicts,
    multi_operator_washpoints: multiGroups,
    clean_single_owner_migrations: plan,
    password_needs_reset: passwordResetNeeded,
  }

  writeFileSync('migration-report.json', JSON.stringify(report, null, 2))

  const md = `# Operator → Org Migration — Dry Run Report
Generated ${report.generated_at}

## Summary
| | |
|---|---|
| Total legacy operators | ${report.counts.total_operators} |
| Unresolved washpoint (can't migrate as-is) | ${report.counts.unresolved_wash_point} |
| Washpoint already linked to an org | ${report.counts.already_org_linked} |
| Email conflicts with organization_users | ${report.counts.email_conflicts} |
| Clean single-owner migrations | ${report.counts.clean_single_owner_migrations} |
| Multi-operator washpoints (role decision needed) | ${report.counts.multi_operator_washpoints} |
| Passwords that can't carry over (need reset) | ${report.counts.password_needs_reset} |

## What "clean" means here
A clean migration: the operator's washpoint resolves uniquely, no other
operator shares it, its email isn't already an organization_users
account, and its wash_points row has no organization_id yet. For those,
the proposed apply step is: create one organization named after the
washpoint, one organization_users row (bcrypt password carried over
as-is if portable, otherwise flagged), one organization_members row as
owner, and backfill wash_points.organization_id.

## Needs a decision before anything is applied
- **Unresolved washpoint** (${report.counts.unresolved_wash_point}): can't
  be migrated until a washpoint is assigned manually.
- **Already org-linked** (${report.counts.already_org_linked}): the
  washpoint already belongs to an organization — migrating the legacy
  operator here means deciding whether they become a member of that
  existing org, not a new one.
- **Email conflicts** (${report.counts.email_conflicts}): the email is
  already a registered organization_users account under a possibly
  different org — needs a call on which identity is authoritative.
- **Multi-operator washpoints** (${report.counts.multi_operator_washpoints}):
  more than one operator resolves to the same washpoint. Full detail
  (including a proposed owner, by earliest created_at) is in
  migration-report.json — needs confirmation, not auto-applied.
- **Password resets** (${report.counts.password_needs_reset}): these
  operators are still on the legacy SHA-256/plaintext hash, not bcrypt,
  so the hash can't be reused as-is for organization_users. They'd need
  a password-reset email as part of the apply step rather than a silent
  hash copy.

Full per-row detail is in migration-report.json.
`
  writeFileSync('migration-report.md', md)

  console.log('Dry run complete — no writes made.')
  console.log(report.counts)
  console.log('\nFull detail written to migration-report.json and migration-report.md')
}

main().catch((err) => {
  console.error('Dry run failed:', err)
  process.exit(1)
})
