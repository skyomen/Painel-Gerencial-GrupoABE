'use client';

import { useMemo, useRef, useState } from 'react';
import { Building2, Check, ChevronDown, Search, X } from 'lucide-react';
import type { DiretoriaCredorOpcao } from '@/lib/diretoria-types';

/**
 * Escolha de um, vários ou todos os credores.
 *
 * Não é um `<select multiple>` nativo: ele exige Ctrl+clique para somar itens,
 * perde a seleção inteira num clique desatento e não comporta busca — com
 * dezenas de credores, vira armadilha. Aqui são checkboxes de verdade dentro
 * de um painel, com busca.
 *
 * Lista vazia = todos. Desmarcar o último devolve ao consolidado, em vez de
 * deixar a tela zerada — ninguém escolhe "nenhum credor" de propósito.
 */
export function SelecaoCredores({
  credores,
  selecionados,
  onChange,
}: {
  credores: DiretoriaCredorOpcao[];
  selecionados: string[];
  onChange: (ids: string[]) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const campoBusca = useRef<HTMLInputElement>(null);

  const escolhidos = useMemo(() => new Set(selecionados), [selecionados]);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return credores;
    return credores.filter((c) => c.razaoSocial.toLowerCase().includes(termo));
  }, [credores, busca]);

  function alternar(id: string) {
    const novo = new Set(escolhidos);
    if (novo.has(id)) novo.delete(id);
    else novo.add(id);
    onChange([...novo]);
  }

  const rotulo =
    selecionados.length === 0
      ? 'Todos os credores'
      : selecionados.length === 1
        ? (credores.find((c) => c.id === selecionados[0])?.razaoSocial ?? '1 credor')
        : `${selecionados.length} credores`;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setAberto((v) => !v);
          // Abrir já com o cursor na busca poupa um clique quando a lista é longa.
          setTimeout(() => campoBusca.current?.focus(), 0);
        }}
        aria-expanded={aberto}
        aria-haspopup="listbox"
        className="flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
      >
        <span className="truncate">{rotulo}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${aberto ? 'rotate-180' : ''}`}
        />
      </button>

      {aberto && (
        <>
          <button
            type="button"
            aria-label="Fechar seleção"
            onClick={() => setAberto(false)}
            className="fixed inset-0 z-10 cursor-default"
          />

          <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-xl border border-border bg-card shadow-card">
            <div className="border-b border-border p-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  ref={campoBusca}
                  type="search"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar credor…"
                  aria-label="Buscar credor"
                  className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-2 text-sm outline-none focus:border-primary"
                />
              </div>

              {selecionados.length > 0 && (
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                  Limpar — voltar a todos
                </button>
              )}
            </div>

            <ul role="listbox" aria-multiselectable className="max-h-64 overflow-y-auto p-1">
              {filtrados.length === 0 && (
                <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                  Nenhum credor encontrado.
                </li>
              )}

              {filtrados.map((c) => {
                const marcado = escolhidos.has(c.id);
                return (
                  <li key={c.id}>
                    <label
                      className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors hover:bg-muted"
                      role="option"
                      aria-selected={marcado}
                    >
                      {/* Checkbox real: teclado, leitor de tela e o clique da
                          linha inteira funcionam sem código extra. */}
                      <input
                        type="checkbox"
                        checked={marcado}
                        onChange={() => alternar(c.id)}
                        className="sr-only"
                      />
                      <span
                        aria-hidden
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                          marcado ? 'border-primary bg-primary' : 'border-border bg-background'
                        }`}
                      >
                        {marcado && <Check className="h-3 w-3 text-primary-foreground" />}
                      </span>
                      <span className="truncate text-foreground">{c.razaoSocial}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

export function IconeCredor() {
  return <Building2 className="h-3.5 w-3.5" />;
}
