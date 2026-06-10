'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import { useEffect } from 'react'

/**
 * Drop this component inside your root layout, inside <PHProvider>.
 * It fires a $pageview event on every route change.
 *
 * Usage in app/layout.js:
 *   import { Suspense } from 'react'
 *   import PostHogPageView from './PostHogPageView'
 *
 *   <PHProvider>
 *     <Suspense fallback={null}>
 *       <PostHogPageView />
 *     </Suspense>
 *     {children}
 *   </PHProvider>
 *
 * Note: Suspense is required because useSearchParams() needs it in Next.js 14.
 */
export default function PostHogPageView() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const posthog = usePostHog()

  useEffect(() => {
    if (pathname && posthog) {
      let url = window.location.origin + pathname
      if (searchParams && searchParams.toString()) {
        url += `?${searchParams.toString()}`
      }
      posthog.capture('$pageview', { $current_url: url })
    }
  }, [pathname, searchParams, posthog])

  return null
}
