// app/routes/login.tsx
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { SignIn, useAuth } from "@clerk/clerk-react";
import { useEffect } from 'react';

export const Route = createFileRoute('/login')({
  component: Login,
  validateSearch: (search: Record<string, unknown>) => {
    return {
      redirect: (search.redirect as string) || '/',
    }
  },
})

function Login() {
  const { isSignedIn } = useAuth();
  const navigate = useNavigate();
  const { redirect } = useSearch({ from: '/login' });

  // If already signed in, redirect to intended destination
  useEffect(() => {
    if (isSignedIn) {
      navigate({ to: redirect, replace: true });
    }
  }, [isSignedIn, navigate, redirect]);

  // Don't render SignIn if already authenticated (prevents flash)
  if (isSignedIn) {
    return null;
  }

  return (
    <div className="h-screen w-full flex items-center justify-center bg-gray-50">
      <div className="shadow-xl rounded-xl overflow-hidden">
        <SignIn 
          afterSignInUrl={redirect}
          afterSignUpUrl={redirect}
          signUpUrl="/signup"
          appearance={{
            elements: {
              rootBox: "mx-auto",
              card: "shadow-none",
            }
          }}
        />
      </div>
    </div>
  );
}