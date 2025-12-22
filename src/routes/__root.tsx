// src/routes/__root.tsx
import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
  Outlet,
  useLocation,
} from '@tanstack/react-router'
import { useAuth } from '@clerk/clerk-react'

import Header from '../components/Header'
import ConvexProvider from '../integrations/convex/provider'
import TanStackQueryDevtools from '../integrations/tanstack-query/devtools'

import appCss from '../styles.css?url'

import type { QueryClient } from '@tanstack/react-query'

interface MyRouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'TanStack Start Starter',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),

  component: RootComponent,
})

// Public routes where Header should NOT be shown
const PUBLIC_ROUTES = ['/login', '/signup']

function RootComponent() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <ConvexProvider>
          <ConditionalHeader />
          <Outlet />
        </ConvexProvider>
        <Scripts />
      </body>
    </html>
  )
}

function ConditionalHeader() {
  const { isSignedIn } = useAuth()
  const location = useLocation()
  
  // Don't show header on public routes or if not signed in
  const isPublicRoute = PUBLIC_ROUTES.includes(location.pathname)
  
  if (!isSignedIn || isPublicRoute) {
    return null
  }
  
  return <Header />
}