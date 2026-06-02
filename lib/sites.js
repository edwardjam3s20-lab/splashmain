/**
 * Subdomain → site identity for middleware routing.
 * Production: splashpass.site, operator.splashpass.site, admin.splashpass.site
 */

export const SITE = {
  CUSTOMER: 'customer',
  OPERATOR: 'operator',
  ADMIN: 'admin',
}

export function getRootDomain() {
  return (process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'splashpass.site').toLowerCase()
}

/**
 * @param {string} hostname - host without port
 * @param {{ devSiteHeader?: string | null }} [opts]
 * @returns {'customer' | 'operator' | 'admin'}
 */
export function getSiteFromHost(hostname, opts = {}) {
  const host = (hostname || '').toLowerCase()
  const root = getRootDomain()

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

  if (host === `admin.${root}`) return SITE.ADMIN
  if (host === `operator.${root}`) return SITE.OPERATOR
  if (host === root || host === `www.${root}`) return SITE.CUSTOMER

  return SITE.CUSTOMER
}

/**
 * @param {'customer' | 'operator' | 'admin'} site
 */
export function getHostForSite(site) {
  const root = getRootDomain()
  if (site === SITE.ADMIN) return `admin.${root}`
  if (site === SITE.OPERATOR) return `operator.${root}`
  return root
}

/**
 * Build absolute URL on the correct subdomain (https in production).
 * @param {'customer' | 'operator' | 'admin'} site
 * @param {string} pathname
 * @param {import('next/server').NextRequest} [request]
 */
export function absoluteUrlForSite(site, pathname, request) {
  const host = getHostForSite(site)
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`

  if (request) {
    const proto = request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', '')
    return `${proto}://${host}${path}`
  }

  const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http'
  return `${protocol}://${host}${path}`
}
