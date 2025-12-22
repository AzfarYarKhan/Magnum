
// src/integrations/convex/provider.tsx
import { ReactNode, useEffect, useState } from 'react'
import { ConvexReactClient } from 'convex/react'
import { ConvexProviderWithClerk } from 'convex/react-clerk'
import { ConvexQueryClient } from '@convex-dev/react-query'
import { ClerkProvider, useAuth } from '@clerk/clerk-react'
import { useNavigate, useLocation } from '@tanstack/react-router'

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL
const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!CONVEX_URL) {
  throw new Error('Missing VITE_CONVEX_URL environment variable')
}

if (!CLERK_PUBLISHABLE_KEY) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY environment variable')
}

const convex = new ConvexReactClient(CONVEX_URL)
const convexQueryClient = new ConvexQueryClient(CONVEX_URL)

// Public routes that don't require authentication
const PUBLIC_ROUTES = ['/login', '/signup']

export default function AppConvexProvider({
  children,
}: {
  children: ReactNode
}) {
  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <AuthGuard>{children}</AuthGuard>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  )
}

function AuthGuard({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [isMounted, setIsMounted] = useState(false)

  // Handle client-side mounting
  useEffect(() => {
    setIsMounted(true)
  }, [])

  const isPublicRoute = PUBLIC_ROUTES.includes(location.pathname)

  useEffect(() => {
    if (!isMounted || !isLoaded) return

    // Redirect unauthenticated users to login
    if (!isSignedIn && !isPublicRoute) {
      navigate({
        to: '/login',
        search: { redirect: location.pathname + location.search },
        replace: true,
      })
      return
    }

    // Redirect authenticated users away from auth pages
    if (isSignedIn && isPublicRoute) {
      const params = new URLSearchParams(location.search)
      const redirect = params.get('redirect') || '/'
      navigate({ to: redirect as any, replace: true })
    }
  }, [isMounted, isLoaded, isSignedIn, isPublicRoute, location, navigate])

  // Show loading screen while initializing
  if (!isMounted || !isLoaded) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 text-sm">Loading authentication...</p>
        </div>
      </div>
    )
  }

  // Don't render protected content if not authenticated
  if (!isSignedIn && !isPublicRoute) {
    return null
  }

  return <>{children}</>
}

// Export the convexQueryClient for use with React Query
export { convexQueryClient }