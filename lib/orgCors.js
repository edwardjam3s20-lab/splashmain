// lib/orgCors.js
// Shared CORS allowlist for /api/org/* routes — the org onboarding/SaaS
// endpoints are called from the same operator React app as /api/operator/*,
// so this intentionally mirrors OPERATOR_REACT_ORIGINS in middleware.js.
// Centralized here rather than copy-pasted into every route file (the
// existing pattern for /api/auth and /api/verify) so a future domain
// change is a one-line edit instead of an N-file audit — the exact class
// of drift that caused the CORS bug already fixed across 18 route files.
export const ORG_APP_ORIGINS = new Set([
  'http://localhost:5173',
  'https://splashpass-operator-react.vercel.app',
  'https://operator.splashpass.site',
])

export function orgCorsHeaders(origin) {
  const allowOrigin = ORG_APP_ORIGINS.has(origin) ? origin : ''
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true',
    // Multiple origins share these routes, so the response MUST vary by
    // Origin — otherwise a CDN/edge cache can serve one origin's response
    // back to a different origin.
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
  }
}
