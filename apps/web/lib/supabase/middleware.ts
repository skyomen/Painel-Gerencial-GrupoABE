import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { decideRouteGuard, type RouteProfile } from '@/lib/route-guards';

function redirectTo(request: NextRequest, pathname: string) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  return NextResponse.redirect(url);
}

function applyRouteHeaders(request: NextRequest, pathname: string) {
  const isLoginRoute = pathname === '/login' || pathname.startsWith('/login/');
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', pathname);
  if (isLoginRoute) {
    requestHeaders.set('x-login-route', '1');
  }
  return { requestHeaders, isLoginRoute };
}

function mergeCookies(source: NextResponse, target: NextResponse) {
  source.cookies.getAll().forEach((cookie) => {
    target.cookies.set(cookie.name, cookie.value, cookie);
  });
}

function finalizeResponse(
  supabaseResponse: NextResponse,
  isLoginRoute: boolean,
  requestHeaders: Headers,
) {
  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  mergeCookies(supabaseResponse, response);

  if (isLoginRoute) {
    response.cookies.set('login-route', '1', { path: '/', sameSite: 'lax' });
  } else {
    response.cookies.delete('login-route');
  }

  return response;
}

async function loadProfile(
  supabase: ReturnType<typeof createServerClient>,
  userId: string,
): Promise<RouteProfile> {
  const { data } = await supabase
    .from('usuarios')
    .select('papel, ativo')
    .eq('id', userId)
    .maybeSingle();
  return data ?? null;
}

/** Renova sessão Supabase, aplica guardas de rota e repassa pathname ao layout. */
export async function handleMiddleware(request: NextRequest): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname;

  if (pathname === '/') {
    return redirectTo(request, '/login');
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const { requestHeaders, isLoginRoute } = applyRouteHeaders(request, pathname);

  if (!url || !key) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const profile = user ? await loadProfile(supabase, user.id) : null;
  const decision = decideRouteGuard(pathname, user?.id, profile);

  if (decision.type === 'redirect') {
    const guardResponse = redirectTo(request, decision.to);
    mergeCookies(supabaseResponse, guardResponse);
    return guardResponse;
  }

  return finalizeResponse(supabaseResponse, isLoginRoute, requestHeaders);
}

/** @deprecated Use handleMiddleware */
export async function updateSession(request: NextRequest) {
  return handleMiddleware(request);
}
