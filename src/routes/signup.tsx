// app/routes/signup.tsx
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { SignUp, useAuth } from "@clerk/clerk-react";
import { useEffect } from 'react';

export const Route = createFileRoute('/signup')({
  component: Signup,
  validateSearch: (search: Record<string, unknown>) => {
    return {
      redirect: (search.redirect as string) || '/',
    }
  },
})

function Signup() {
  const { isSignedIn } = useAuth();
  const navigate = useNavigate();
  const { redirect } = useSearch({ from: '/signup' });

  // If already signed in, redirect to intended destination
  useEffect(() => {
    if (isSignedIn) {
      navigate({ to: redirect, replace: true });
    }
  }, [isSignedIn, navigate, redirect]);

  // Don't render SignUp if already authenticated (prevents flash)
  if (isSignedIn) {
    return null;
  }

  return (
    <div className="h-screen w-full flex items-center justify-center bg-gray-50">
      <div className="shadow-xl rounded-xl overflow-hidden">
        <SignUp 
          afterSignUpUrl={redirect}
          afterSignInUrl={redirect}
          signInUrl="/login"
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