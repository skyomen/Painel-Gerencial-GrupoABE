import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/server/rate-limit';

type LoginProfile = {
  id: string;
  tenantId: string;
  email: string;
  nome: string;
  papel: string;
  ativo?: boolean;
  fotoUrl?: string | null;
};

const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

function clientKey(request: Request, email: string) {
  const fwd = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = fwd || request.headers.get('x-real-ip') || 'unknown';
  return `login:${ip}:${email.toLowerCase()}`;
}

async function loadProfile(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<LoginProfile | null> {
  const { data, error } = await supabase
    .from('usuarios')
    .select('id, tenant_id, email, nome, papel, ativo, foto_url')
    .eq('id', userId)
    .maybeSingle();

  if (error || !data) return null;
  if (!data.ativo) return null;

  return {
    id: data.id,
    tenantId: data.tenant_id,
    email: data.email,
    nome: data.nome,
    papel: data.papel,
    ativo: data.ativo,
    fotoUrl: data.foto_url,
  };
}

export async function POST(request: Request) {
  let body: { email?: string; senha?: string };
  try {
    body = (await request.json()) as { email?: string; senha?: string };
  } catch {
    return NextResponse.json({ title: 'Requisição inválida.' }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase() ?? '';
  const senha = body.senha ?? '';

  if (!email || !senha) {
    return NextResponse.json({ title: 'Informe e-mail e senha.' }, { status: 400 });
  }

  const limited = checkRateLimit(clientKey(request, email), {
    limit: LOGIN_LIMIT,
    windowMs: LOGIN_WINDOW_MS,
  });

  if (!limited.ok) {
    return NextResponse.json(
      { title: 'Muitas tentativas. Aguarde um momento e tente novamente.' },
      {
        status: 429,
        headers: { 'Retry-After': String(limited.retryAfterSec) },
      },
    );
  }

  const supabase = await createClient();
  let data: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>['data'];
  let error: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>['error'];
  try {
    ({ data, error } = await supabase.auth.signInWithPassword({
      email,
      password: senha,
    }));
  } catch (err) {
    const cause =
      err instanceof Error ? String((err as Error & { cause?: unknown }).cause ?? err) : '';
    console.error('[auth/login] falha de rede ao falar com Supabase', cause || err);
    return NextResponse.json(
      {
        title:
          'Não foi possível conectar ao Supabase. Verifique a internet do Docker (DNS) e tente novamente.',
      },
      { status: 503 },
    );
  }

  if (error || !data.user) {
    return NextResponse.json({ title: 'E-mail ou senha incorretos.' }, { status: 401 });
  }

  const profile = await loadProfile(supabase, data.user.id);
  if (!profile) {
    await supabase.auth.signOut();
    return NextResponse.json(
      { title: 'Conta desativada ou perfil não encontrado.' },
      { status: 403 },
    );
  }

  return NextResponse.json(profile);
}
