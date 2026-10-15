import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicSupabaseConfig } from "@/lib/supabase/config";

const protectedPaths = [
  "/",
  "/companies",
  "/contacts",
  "/inbox",
  "/campaigns",
  "/tasks",
  "/analytics",
  "/settings",
];

function isProtectedPath(pathname: string) {
  return protectedPaths.some((path) =>
    path === "/" ? pathname === path : pathname === path || pathname.startsWith(`${path}/`),
  );
}

function redirectWithCookies(url: URL, response: NextResponse) {
  const redirectResponse = NextResponse.redirect(url);
  response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
  return redirectResponse;
}

export async function updateSession(request: NextRequest) {
  const { url, anonKey } = getPublicSupabaseConfig();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  // getClaims verifies the session token locally when the project signs JWTs with asymmetric keys
  // (no round trip to Supabase on every request); otherwise it falls back to the same server check.
  const { data: claimsData } = await supabase.auth.getClaims();
  const user = claimsData?.claims?.sub ? { id: claimsData.claims.sub } : null;
  const pathname = request.nextUrl.pathname;

  if (!user && isProtectedPath(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    return redirectWithCookies(loginUrl, response);
  }

  if (user && pathname === "/login") {
    const appUrl = request.nextUrl.clone();
    appUrl.pathname = "/";
    appUrl.search = "";
    return redirectWithCookies(appUrl, response);
  }

  return response;
}
