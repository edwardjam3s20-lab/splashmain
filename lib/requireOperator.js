import { headers } from 'next/headers'
import { getOperatorSession } from '@/lib/operatorSession'
import { loadOperatorByEmail } from '@/lib/loadOperator'

// The operator session cookie has to be SameSite=None (the operator SPA
// and this API are on different origins), which disables the browser's
// normal CSRF protection. Because every operator route already calls
// requireOperator() as its single auth chokepoint, this is the one place
// to enforce an Origin allowlist instead of adding a check to every
// individual route file.
//
// Set OPERATOR_APP_ORIGINS in this environment's variables to a
// comma-separated list of the exact origins the operator app is served
// from, e.g. "https://operator.splashpass.site". No wildcards, no
// trailing slash.
const ALLOWED_ORIGINS = (process.env.OPERATOR_APP_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

function isAllowedOrigin(origin) {
  // Modern browsers always attach an Origin header to cross-origin
  // requests — that's precisely the mechanism CSRF relies on, so it's
  // reliable to check. A request arriving with no Origin header at all
  // wasn't a cross-site browser request, so it's let through here; only
  // a present-but-unrecognized Origin gets rejected.
  if (!origin) return true
  return ALLOWED_ORIGINS.includes(origin)
}

export async function requireOperator() {
  const origin = headers().get('origin')
  if (!isAllowedOrigin(origin)) {
    return { error: 'Forbidden', status: 403 }
  }

  const session = await getOperatorSession()
  if (!session?.email) return { error: 'Unauthorized', status: 401 }

  const { op, error } = await loadOperatorByEmail(session.email)
  if (error) return { error: 'Could not load operator', status: 500 }
  if (!op) return { error: 'Operator not found', status: 401 }

  return { operator: op }
}

