import { NextResponse } from 'next/server'
import {
  SITE,
  getSiteFromHost,
  absoluteUrlForSite,
} from '@/lib/sites'
import { verifyAdminSession, verifyOperatorSession } from '@/lib/auth-middleware'

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
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
