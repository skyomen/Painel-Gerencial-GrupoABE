import { NextResponse } from 'next/server';

/** Healthcheck mínimo (blueprint §6.3 / §8.2) — sem PII. */
export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      service: 'painel-gerencial-grupoabe-web',
      ts: new Date().toISOString(),
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}
