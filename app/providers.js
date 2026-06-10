'use client'

import posthog from 'posthog-js'
import { PostHogProvider } from 'posthog-js/react'
import { useEffect } from 'react'

export function PHProvider({ children }) {
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) {
      console.warn('[PostHog] NEXT_PUBLIC_POSTHOG_KEY is not set.')
      return
    }

    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com',
      capture_pageview: false,       // handled manually in PostHogPageView
      capture_pageleave: true,       // track when admins leave a page
      persistence: 'localStorage',
      autocapture: false,            // manual events only — cleaner data
      disable_session_recording: false,
      loaded: (ph) => {
        if (process.env.NODE_ENV === 'development') {
          ph.debug()                 // logs events to console in dev
        }
      },
    })
  }, [])

  return <PostHogProvider client={posthog}>{children}</PostHogProvider>
}
