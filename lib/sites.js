/**
 * Subdomain → site identity for middleware routing.
 * Production: splashpass.site, operator.splashpass.site, admin.splashpass.site
 */

export const SITE = {
  CUSTOMER: 'customer',
  OPERATOR: 'operator',
  ADMIN: 'admin',
}

const CANONICAL_ROOT = 'splashpass.site'

/** Correct common typo: slashpass.site → splashpass.site */
function normalizeRootDomain(value) {
  const v = (value || '').toLowerCase().trim()
  if (!v || v === 'slashpass.site' || v.endsWith('.slashpass.site')) {
    return CANONICAL_ROOT
  }
  return v
}

/**
 * @param {string} [hostname] - request host (used to infer root when env is wrong)
 */
export function getRootDomain(hostname) {
  const host = (hostname || '').toLowerCase()
  if (host === CANONICAL_ROOT || host.endsWith(`.${CANONICAL_ROOT}`)) {
    return CANONICAL_ROOT
  }
  return normalizeRootDomain(process.env.NEXT_PUBLIC_ROOT_DOMAIN)
}

/**
 * @param {string} hostname - host without port
 * @param {{ devSiteHeader?: string | null }} [opts]
 * @returns {'customer' | 'operator' | 'admin'}
 */
export function getSiteFromHost(hostname, opts = {}) {
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

  // Subdomain prefix (works even if NEXT_PUBLIC_ROOT_DOMAIN was set to slashpass.site)
  if (host.startsWith('operator.')) return SITE.OPERATOR
  if (host.startsWith('admin.')) return SITE.ADMIN

  if (host === root || host === `www.${root}`) return SITE.CUSTOMER
  if (host === CANONICAL_ROOT || host === `www.${CANONICAL_ROOT}`) return SITE.CUSTOMER

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
