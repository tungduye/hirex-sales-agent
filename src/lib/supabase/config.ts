import { z } from "zod";

const publicSupabaseConfigSchema = z.object({
  url: z.url(),
  anonKey: z.string().min(1),
});

export type PublicSupabaseConfig = z.infer<typeof publicSupabaseConfigSchema>;

/**
 * Validates configuration only when a future Supabase client is created.
 * Phase 1A intentionally does not initialize or connect a client.
 */
export function getPublicSupabaseConfig(): PublicSupabaseConfig {
  return publicSupabaseConfigSchema.parse({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}
