'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { CredoresTable } from '@/components/admin/credores-table';
import { BotaoSync } from '@/components/admin/botao-sync';
import { KpiSection } from '@/components/dashboard/kpi-section';
import { listCredores, type Credor } from '@/lib/admin-api';
import { toApiError } from '@/lib/api-client';
import type { KpiItem } from '@/lib/dashboard-mock';

function buildKpis(credores: Credor[]): KpiItem[] {
  const ativos = credores.filter((c) => c.tenantStatus === 'ATIVO').length;
  const comResponsavel = credores.filter((c) => c.responsavel).length;
  const estados = new Set(credores.map((c) => c.estado).filter(Boolean)).size;

  return [
    {
      rotulo: 'Total de credores',
      valor: String(credores.length),
      detalhe: 'Cadastrados na plataforma',
    },
    { rotulo: 'Ativos', valor: String(ativos), detalhe: 'Com acesso ao painel' },
    { rotulo: 'Com responsável', valor: String(comResponsavel), detalhe: 'Login configurado' },
    { rotulo: 'Estados (UF)', valor: String(estados), detalhe: 'Distribuição geográfica' },
  ];
}

export default function CredoresPage() {
  const [credores, setCredores] = useState<Credor[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const data = await listCredores();
      setCredores(data);
    } catch (err) {
      setErro(toApiError(err).title);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  if (carregando) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <>
      <KpiSection hideHeader kpis={buildKpis(credores)} />

      {erro && (
        <p
          role="alert"
          className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
        >
          {erro}
        </p>
      )}

      <section>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-base font-semibold text-foreground">
              Lista de credores
            </h2>
            <p className="text-xs text-muted-foreground">
              Códigos em primeiro · busca por nome, CNPJ ou código · filtros por responsável.
            </p>
          </div>
          <div className="flex flex-wrap items-start gap-3">
            <BotaoSync onConcluido={carregar} />
            <Link
              href="/admin/credores/novo"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft transition-opacity hover:opacity-90"
            >
              <Plus className="h-4 w-4" />
              Novo credor
            </Link>
          </div>
        </div>

        <CredoresTable credores={credores} />
      </section>
    </>
  );
}
