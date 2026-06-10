import './globals.css'
import { Suspense } from 'react'
import { PHProvider } from './providers'
import PostHogPageView from './PostHogPageView'

export const metadata = {
  title: 'SplashPass',
  description: 'SplashPass — car wash membership',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet" />
      </head>
      <body>
        <PHProvider>
          <Suspense fallback={null}>
            <PostHogPageView />
          </Suspense>
          {children}
        </PHProvider>
      </body>
    </html>
  )
}