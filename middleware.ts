import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() { return request.cookies.getAll(); },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  try {
    // Under FREE Disk IO throttle (6 MB/s) auth check can hang >25s → 504
    // Race it: 1.8s timeout, else pass through unauthenticated and let page/API decide
    await Promise.race([
      supabase.auth.getUser(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('auth-timeout')), 1800)),
    ]);
  } catch {}
  return response;
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|api/backup).*)'] };
