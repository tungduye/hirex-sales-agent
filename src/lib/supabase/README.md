# Supabase boundary

This folder contains the Phase 1B.2 Supabase SSR boundary:

- `client.ts` creates the publishable browser client.
- `server.ts` creates a cookie-aware client for Server Components and actions.
- `proxy.ts` refreshes auth cookies at the Next.js proxy boundary.
- `config.ts` validates only the two public Supabase environment variables.

No service-role credential belongs in this folder or in browser code. Database reads continue to rely on the authenticated user and Row Level Security.
