// convex/auth.config.ts
export default {
    providers: [
      {
        domain: "https://still-stinkbug-42.clerk.accounts.dev/", // Get this from Clerk Dashboard -> API Keys -> JWT Templates (or Issuer URL)
        applicationID: "convex",
      },
    ],
  };
