import { NextResponse } from 'next/server'
import { jwtVerify } from 'jose'

// ── Inlined from @/lib/sites ──────────────────────────────────────
const SITE = {
  CUSTOMER: 'customer',
  OPERATOR: 'operator',
  ADMIN: 'admin',
}

const CANONICAL_ROOT = 'splashpass.site'

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
  const host = (hostname || '').toLowerCase()
  const root = getRootDomain(host)

  if (process.env.NODE_ENV === 'development') {
    const headerSite = opts.devSiteHeader?.toLowerCase()
    if (headerSite === SITE.ADMIN || headerSite === SITE.OPERATOR || headerSite === SITE.CUSTOMER) {
      return headerSite
    }
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

function getSecretKey() {
  return new TextEncoder().encode(
    process.env.SESSION_SECRET || 'fallback_secret_32_chars_minimum!!'
  )
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

const ADMIN_PUBLIC_API = new Set([
  '/api/auth/login',
  '/api/auth/logout',
  '/api/tfa/email-send',
  '/api/tfa/email-verify',
])

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
  return pathname.startsWith('/api/auth') || pathname.startsWith('/api/tfa')
}

function isOperatorApi(pathname) {
  return pathname.startsWith('/api/operator')
}

function isAdminPaymentsApi(pathname) {
  return pathname.startsWith('/api/operator-payments')
}

export async function middleware(request) {
  const hostname = hostnameFromRequest(request)
  const site = getSiteFromHost(hostname, {
    devSiteHeader: request.headers.get('x-splashpass-site'),
  })
  const { pathname } = request.nextUrl

  if (pathname.startsWith('/_next')) {
    return NextResponse.next()
  }

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
      // Root domain → landing page
      url.pathname = '/splashpass-landing-page.html'
      return NextResponse.rewrite(url)
    }
    // app.splashpass.site (and any other subdomain) → customer app
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
