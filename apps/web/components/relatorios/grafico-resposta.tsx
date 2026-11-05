'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { PontoSerie } from '@/lib/relatorios-ia/executor';
import type { TipoRelatorio } from '@/lib/relatorios-ia/catalogo';
import {
  formatarMarcaEixo,
  formatarValorSerie,
  montarEspecGrafico,
  type EspecGrafico,
} from '@/lib/relatorios-visualizacao';

/**
 * O gráfico da resposta — um só componente para os seis tipos do catálogo.
 *
 * DEC-0071: ele lê a FORMA do que chegou (`montarEspecGrafico`) e desenha o que
 * couber. Fixar aqui a linha temporal ABE WEB × Delphi do protótipo faria
 * "Carteira ativa", que hoje vem por UF, desenhar uma evolução que não existe
 * em fonte nenhuma.
 *
 * As cores saem das variáveis do tema, não de hex: assim o claro e o escuro
 * trocam juntos com o resto do painel, sem um segundo lugar para manter.
 */
export function GraficoResposta({
  tipoRelatorio,
  serie,
  titulo,
}: {
  tipoRelatorio: TipoRelatorio;
  serie: PontoSerie[];
  titulo: string;
}) {
  const espec = montarEspecGrafico(tipoRelatorio, serie);

  if (!espec) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-6">
        <h3 className="font-display text-sm font-semibold text-foreground">{titulo}</h3>
        <p className="py-8 text-center text-sm text-muted-foreground">
          Sem dados para o gráfico neste recorte.
        </p>
      </div>
    );
  }

  return (
    <figure className="m-0 rounded-2xl border border-border bg-surface p-4">
      <figcaption className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-display text-sm font-semibold text-foreground">{titulo}</h3>
        <span className="text-xs text-muted-foreground">{espec.legendaEixo}</span>
      </figcaption>

      <Legenda espec={espec} />

      <div
        className="h-64 w-full sm:h-72"
        role="img"
        aria-label={`${titulo}. ${espec.legendaEixo}. Séries: ${espec.series
          .map((s) => s.rotulo)
          .join(', ')}.`}
      >
        <ResponsiveContainer width="100%" height="100%">
          {espec.forma === 'linha' ? (
            <AreaChart data={serie} margin={MARGEM}>
              <defs>
                {espec.series.map((s) => (
                  <linearGradient key={s.chave} id={`fill-${s.chave}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={s.cor} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={s.cor} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              {eixos(espec)}
              {espec.series.map((s) => (
                <Area
                  key={s.chave}
                  type="monotone"
                  dataKey={s.chave}
                  name={s.rotulo}
                  stroke={s.cor}
                  strokeWidth={2.5}
                  fill={`url(#fill-${s.chave})`}
                  dot={{ r: 3, strokeWidth: 0, fill: s.cor }}
                  activeDot={{ r: 5, strokeWidth: 0 }}
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          ) : (
            <BarChart data={serie} margin={MARGEM}>
              {eixos(espec)}
              {espec.series.map((s) => (
                <Bar
                  key={s.chave}
                  dataKey={s.chave}
                  name={s.rotulo}
                  fill={s.cor}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={44}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

/** `top` generoso: sem ele o Recharts corta a marca mais alta do eixo Y. */
const MARGEM = { top: 16, right: 8, bottom: 0, left: 0 };

const COR_EIXO = 'hsl(var(--muted-foreground))';
const COR_GRADE = 'hsl(var(--border))';

/**
 * Eixos e tooltip são iguais nas duas formas; escrevê-los duas vezes é como
 * eles passam a divergir. Recharts exige que sejam filhos diretos do gráfico,
 * então vêm como fragmento.
 */
function eixos(espec: EspecGrafico) {
  return (
    <>
      <CartesianGrid stroke={COR_GRADE} strokeDasharray="3 3" vertical={false} />
      <XAxis
        dataKey="rotulo"
        tick={{ fill: COR_EIXO, fontSize: 11 }}
        tickLine={false}
        axisLine={{ stroke: COR_GRADE }}
        interval="preserveStartEnd"
        minTickGap={8}
      />
      <YAxis
        tick={{ fill: COR_EIXO, fontSize: 11 }}
        tickLine={false}
        axisLine={false}
        width={72}
        tickMargin={6}
        tickFormatter={(v: number) => formatarMarcaEixo(v, espec.unidade)}
      />
      <Tooltip
        cursor={{ fill: 'hsl(var(--muted) / 0.5)' }}
        contentStyle={{
          background: 'hsl(var(--card))',
          border: '1px solid hsl(var(--border))',
          borderRadius: '0.75rem',
          fontSize: '0.8rem',
          color: 'hsl(var(--card-foreground))',
          boxShadow: '0 2px 4px hsl(220 43% 11% / 0.04), 0 12px 32px -8px hsl(220 43% 11% / 0.10)',
        }}
        labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}
        formatter={(valor, nome) => [
          formatarValorSerie(Number(valor ?? 0), espec.unidade),
          String(nome ?? ''),
        ]}
      />
    </>
  );
}

/**
 * Legenda própria em vez da `<Legend>` do Recharts: a do pacote traz tipografia
 * e espaçamento que não são os do painel, e o protótipo congelado mostra a
 * legenda acima do gráfico, com bolinha, não abaixo.
 */
function Legenda({ espec }: { espec: EspecGrafico }) {
  return (
    <ul className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium text-muted-foreground">
      {espec.series.map((s) => (
        <li key={s.chave} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: s.cor }}
          />
          {s.rotulo}
        </li>
      ))}
    </ul>
  );
}
