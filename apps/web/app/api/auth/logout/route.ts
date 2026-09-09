import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    return NextResponse.json({ title: 'Não foi possível encerrar a sessão.' }, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}
