import { NextResponse } from 'next/server'
import { jwtVerify } from 'jose'

// ── Inlined from @/lib/sites ──────────────────────────────────────
const SITE = {
  CUSTOMER: 'customer',
  OPERATOR: 'operator',
  ADMIN: 'admin',
}

const CANONICAL_ROOT = 'splashpass.site'

// Origins allowed to call /api/operator/* from a browser cross-origin context.
// localhost:5173 = Vite dev server; the Vercel URL = deployed operator React app.
const OPERATOR_REACT_ORIGINS = new Set([
  'http://localhost:5173',
  'https://splashpass-operator-react.vercel.app',
  'https://operator.splashpass.site',
])

function normalizeRootDomain(value) {
  const v = (value || '').toLowerCase().trim()
  if (!v || v === 'slashpass.site' || v.endsWith('.slashpass.site')) {
    return CANONICAL_ROOT
  }
  return v
}

function getRootDomain(hostname) {
  const host = (hostname || '').toLowerCase()
  if (host === CANONICAL_ROOT || host.endsWith(`.${CANONICAL_ROOT}`)) {
    return CANONICAL_ROOT
  }
  return normalizeRootDomain(process.env.NEXT_PUBLIC_ROOT_DOMAIN)
}

function getSiteFromHost(hostname, opts = {}) {
  // Allow the operator React dev app (localhost) to call operator APIs
  if (hostname === 'localhost') return SITE.OPERATOR

  // Allow proxied dev builds to identify themselves via header (all envs,
  // since Vite proxy runs against the deployed Vercel instance which is
  // always NODE_ENV=production).
  const headerSite = opts.devSiteHeader?.toLowerCase()
  if (headerSite === SITE.ADMIN || headerSite === SITE.OPERATOR || headerSite === SITE.CUSTOMER) {
    return headerSite
  }

  const host = (hostname || '').toLowerCase()
  const root = getRootDomain(host)

  if (process.env.NODE_ENV === 'development') {
    const devOverride = process.env.DEV_SITE?.toLowerCase()
    if (devOverride === SITE.ADMIN || devOverride === SITE.OPERATOR || devOverride === SITE.CUSTOMER) {
      return devOverride
    }
  }

  if (host.startsWith('operator.')) return SITE.OPERATOR
  if (host.startsWith('admin.')) return SITE.ADMIN
  if (host === root || host === `www.${root}`) return SITE.CUSTOMER
  if (host === CANONICAL_ROOT || host === `www.${CANONICAL_ROOT}`) return SITE.CUSTOMER
  return SITE.CUSTOMER
}

function getHostForSite(site) {
  const root = getRootDomain()
  if (site === SITE.ADMIN) return `admin.${root}`
  if (site === SITE.OPERATOR) return `operator.${root}`
  return root
}

function absoluteUrlForSite(site, pathname, request) {
  const host = getHostForSite(site)
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`
  if (request) {
    const proto = request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', '')
    return `${proto}://${host}${path}`
  }
  const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http'
  return `${protocol}://${host}${path}`
}

// ── Inlined from @/lib/auth-middleware ───────────────────────────
const ADMIN_COOKIE = 'splashpass_session'
const OPERATOR_COOKIE = 'splashpass_operator_session'

// SECURITY: no fallback secret -- see lib/session.js for why. Every request
// that needs a session check will throw (caught below, treated as
// "unauthenticated") rather than silently verifying against a public
// hardcoded string if SESSION_SECRET was never configured.
function getSecretKey() {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET is not set (or is shorter than 32 chars).')
  }
  return new TextEncoder().encode(secret)
}

async function verifyAdminSession(request) {
  const token = request.cookies.get(ADMIN_COOKIE)?.value
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, getSecretKey())
    return payload
  } catch {
    return null
  }
}

async function verifyOperatorSession(request) {
  const token = request.cookies.get(OPERATOR_COOKIE)?.value
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, getSecretKey())
    if (payload.role !== 'operator') return null
    return payload
  } catch {
    return null
  }
}

const STATIC_EXT = /\.(?:html|css|js|mjs|json|svg|ico|png|jpe?g|webp|gif|woff2?|webmanifest|txt|map)$/i

const OPERATOR_PUBLIC_API = new Set([
  '/api/operator/auth/login',
  '/api/operator/auth/logout',
])

function hostnameFromRequest(request) {
  return request.headers.get('host')?.split(':')[0]?.toLowerCase() ?? ''
}

function isStaticAsset(pathname) {
  return STATIC_EXT.test(pathname)
}

function isAdminProtectedApi(pathname) {
  return (
    pathname.startsWith('/api/data') ||
    pathname.startsWith('/api/operators') ||
    pathname.startsWith('/api/wash-points')
  )
}

function isAdminAuthApi(pathname) {
  // NOTE: /api/auth/* (login, register, logout) is customer-facing and
  // handles its own CORS via CUSTOMER_APP_ORIGIN in each route file — it
  // must NOT be gated to the admin subdomain here. Only /api/tfa/* is
  // genuinely admin-only (no CORS headers of its own, same-origin calls
  // from admin.splashpass.site only).
  return pathname.startsWith('/api/tfa')
}

function isOperatorApi(pathname) {
  return pathname.startsWith('/api/operator')
}

function isAdminPaymentsApi(pathname) {
  return pathname.startsWith('/api/operator-payments')
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    // Multiple origins share this same route, so the response MUST vary by
    // Origin — otherwise a CDN/edge cache can serve one origin's preflight
    // response (e.g. localhost:5173 during dev) back to a different origin
    // (e.g. a newly added custom domain), which is exactly the mismatched
    // Access-Control-Allow-Origin bug this caused.
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
  }
}

export async function middleware(request) {
  const hostname = hostnameFromRequest(request)
  const { pathname } = request.nextUrl
  const requestOrigin = request.headers.get('origin') || ''

  if (pathname.startsWith('/_next')) {
    return NextResponse.next()
  }

  // ── CORS + site-check bypass for the operator React app ──────────
  // Requests from OPERATOR_REACT_ORIGINS are always treated as operator-site
  // calls, regardless of what hostname the request hits. This covers both
  // the Vite dev server (localhost:5173) and the deployed Vercel app.
  if (isOperatorApi(pathname) && OPERATOR_REACT_ORIGINS.has(requestOrigin)) {
    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new NextResponse(null, {
        status: 204,
        headers: corsHeaders(requestOrigin),
      })
    }

    // Auth check (same logic as the normal operator API path below)
    if (!OPERATOR_PUBLIC_API.has(pathname)) {
      const session = await verifyOperatorSession(request)
      if (!session) {
        const res = NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        Object.entries(corsHeaders(requestOrigin)).forEach(([k, v]) => res.headers.set(k, v))
        return res
      }
    }

    const response = NextResponse.next()
    Object.entries(corsHeaders(requestOrigin)).forEach(([k, v]) => response.headers.set(k, v))
    return response
  }

  const site = getSiteFromHost(hostname, {
    devSiteHeader: request.headers.get('x-splashpass-site'),
  })

  const url = request.nextUrl.clone()

  if (pathname.startsWith('/api')) {
    if (isAdminPaymentsApi(pathname)) {
      if (site !== SITE.ADMIN) {
        return NextResponse.json(
          { error: 'Operator payments API is only available on the admin subdomain.' },
          { status: 403 }
        )
      }
      const session = await verifyAdminSession(request)
      if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      return NextResponse.next()
    }

    if (isAdminProtectedApi(pathname) || isAdminAuthApi(pathname)) {
      if (site !== SITE.ADMIN) {
        return NextResponse.json(
          { error: 'Admin API is only available on the admin subdomain.' },
          { status: 403 }
        )
      }
      if (isAdminProtectedApi(pathname)) {
        const session = await verifyAdminSession(request)
        if (!session) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
      }
      return NextResponse.next()
    }

    if (isOperatorApi(pathname)) {
      if (site !== SITE.OPERATOR) {
        return NextResponse.json(
          { error: 'Operator API is only available on the operator subdomain.' },
          { status: 403 }
        )
      }
      if (!OPERATOR_PUBLIC_API.has(pathname)) {
        const session = await verifyOperatorSession(request)
        if (!session) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
      }
      return NextResponse.next()
    }

    return NextResponse.next()
  }

  if (site === SITE.ADMIN) {
    if (pathname === '/' || pathname === '') {
      url.pathname = '/admin'
      return NextResponse.rewrite(url)
    }
    if (pathname.startsWith('/admin')) {
      return NextResponse.next()
    }
    if (pathname.startsWith('/operator') || pathname === '/index.html') {
      return NextResponse.redirect(absoluteUrlForSite(SITE.CUSTOMER, '/', request))
    }
    if (isStaticAsset(pathname)) {
      return NextResponse.next()
    }
    url.pathname = '/admin'
    return NextResponse.rewrite(url)
  }

  if (site === SITE.OPERATOR) {
    if (pathname === '/' || pathname === '') {
      url.pathname = '/operator_v4.html'
      return NextResponse.rewrite(url)
    }
    if (pathname === '/operator' || pathname === '/operator.html') {
      url.pathname = '/operator_v4.html'
      return NextResponse.rewrite(url)
    }
    if (pathname.startsWith('/admin')) {
      return NextResponse.redirect(absoluteUrlForSite(SITE.ADMIN, pathname, request))
    }
    if (pathname === '/index.html') {
      return NextResponse.redirect(absoluteUrlForSite(SITE.CUSTOMER, '/', request))
    }
    return NextResponse.next()
  }

  // CUSTOMER site (splashpass.site and app.splashpass.site)
  if (pathname === '/' || pathname === '') {
    if (hostname === 'splashpass.site' || hostname === 'www.splashpass.site') {
      url.pathname = '/splashpass-landing-page.html'
      return NextResponse.rewrite(url)
    }
    url.pathname = '/index.html'
    return NextResponse.rewrite(url)
  }
  if (pathname.startsWith('/admin')) {
    return NextResponse.redirect(absoluteUrlForSite(SITE.ADMIN, pathname, request))
  }
  if (
    pathname.startsWith('/operator') ||
    pathname === '/operator_v4.html' ||
    pathname === '/operator.html'
  ) {
    return NextResponse.redirect(absoluteUrlForSite(SITE.OPERATOR, '/', request))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|ingest).*)',
  ],
}
