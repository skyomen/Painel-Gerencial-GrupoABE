import { NextResponse } from 'next/server';
import { requireSuperAdmin, adminDb, jsonError } from '@/lib/server/admin-auth';
import { filtrar, montarDashboardDeAgregados, type Agregados } from '@/lib/payload-de-agregados';
import type { DiretoriaResponse } from '@/lib/diretoria-types';

/**
 * A MESMA tela do dashboard, com todos os credores somados.
 *
 * Devolve um `DashboardPayload` idêntico ao do credor — os componentes não
 * sabem se desenham um credor ou a soma de todos. Com `credorIds`, a mesma
 * tela isola um subconjunto.
 *
 * Lê apenas as tabelas de agregado, nunca `carteira_snapshot`: varrer milhões
 * de linhas de fato a cada carga é o que os agregados existem para evitar, e
 * esta é a tela com mais gente abrindo ao mesmo tempo (a diretoria chega junto,
 * de manhã).
 *
 * Autorização: SUPER_ADMIN. Um papel próprio de diretoria — só leitura, sem
 * cadastro nem usuários — seria mais correto e está anotado como pendência;
 * hoje SUPER_ADMIN é o único papel com alcance sobre todos os tenants.
 */

/** Janela padrão: ano corrente, igual à do sync (`getSyncDateRange`). */
function periodoPadrao(): { de: string; ate: string } {
  const ano = new Date().getFullYear();
  return { de: `${ano}-01-01`, ate: `${ano}-12-31` };
}

function parseFiltros(sp: URLSearchParams) {
  const padrao = periodoPadrao();
  const de = sp.get('de')?.trim() || padrao.de;
  const ate = sp.get('ate')?.trim() || padrao.ate;

  // Aceita repetido (?credorIds=a&credorIds=b) e separado por vírgula, porque
  // as duas formas circulam por aí e um link colado não pode falhar calado.
  const credorIds = [
    ...new Set(
      [...sp.getAll('credorIds'), ...sp.getAll('credorId')]
        .flatMap((v) => v.split(','))
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];

  return {
    credorIds,
    uf: sp.get('uf')?.trim() || 'todos',
    // Datas invertidas viram intervalo vazio e a tela zera sem explicação.
    ...(de <= ate ? { de, ate } : { de: ate, ate: de }),
  };
}

export async function GET(request: Request) {
  const auth = await requireSuperAdmin();
  if (auth instanceof NextResponse) return auth;

  const filtros = parseFiltros(new URL(request.url).searchParams);
  const db = adminDb();

  try {
    const [credoresRes, borderoRes, repasseRes, posicaoRes, classeRes, faixaRes, syncRes] =
      await Promise.all([
        db.from('credores').select('id, razao_social').order('razao_social'),
        db
          .from('metricas_mensais_bordero')
          .select('credor_id, competencia, uf, bordero_valor, bordero_qtd, idade_soma, idade_qtd'),
        db
          .from('metricas_mensais_repasse')
          .select('credor_id, competencia, uf, recebido_abe, pagamento_direto'),
        db.from('metricas_posicao').select('credor_id, uf, ativo_saldo_devedor, ativo_qtd'),
        db
          .from('metricas_mensais_classe')
          .select(
            'credor_id, competencia, uf, tipo_classe, classe, valor_original, saldo, qtd_processos',
          ),
        db
          .from('metricas_mensais_faixa')
          .select('credor_id, competencia, uf, faixa_idade, bordero_valor, recebido_valor'),
        db.from('sync_state').select('ultima_sucesso'),
      ]);

    const erro =
      credoresRes.error ??
      borderoRes.error ??
      repasseRes.error ??
      posicaoRes.error ??
      classeRes.error ??
      faixaRes.error ??
      syncRes.error;

    if (erro) {
      console.error('[diretoria GET]', erro);
      return jsonError('Erro ao montar o consolidado.', 500);
    }

    const bruto: Agregados = {
      bordero: (borderoRes.data ?? []) as Agregados['bordero'],
      repasse: (repasseRes.data ?? []) as Agregados['repasse'],
      posicao: (posicaoRes.data ?? []) as Agregados['posicao'],
      classe: (classeRes.data ?? []) as Agregados['classe'],
    };

    const ag = filtrar(bruto, filtros);

    type LinhaFaixa = {
      credor_id: string;
      competencia: string;
      uf: string;
      faixa_idade: string;
      bordero_valor: string | number | null;
      recebido_valor: string | number | null;
    };

    // A faixa segue o mesmo recorte das demais — sem isso, o gráfico de idade
    // mostraria o consolidado enquanto o resto da tela mostra um credor só.
    const escolhidos = filtros.credorIds.length ? new Set(filtros.credorIds) : null;

    const faixas = ((faixaRes.data ?? []) as LinhaFaixa[]).filter((f) => {
      if (escolhidos && !escolhidos.has(f.credor_id)) return false;
      if (filtros.uf !== 'todos' && f.uf !== filtros.uf) return false;
      return f.competencia >= filtros.de && f.competencia <= filtros.ate;
    });

    // Idade do consolidado = a do credor MAIS ATRASADO. "Atualizado agora" com
    // um credor parado há uma semana afirma um frescor que não existe.
    const datas = ((syncRes.data ?? []) as { ultima_sucesso: string | null }[])
      .map((s) => s.ultima_sucesso)
      .filter((d): d is string => Boolean(d))
      .sort();

    type CredorRow = { id: string; razao_social: string };
    const credores = ((credoresRes.data ?? []) as CredorRow[]).map((c) => ({
      id: c.id,
      razaoSocial: c.razao_social,
    }));

    // UFs vêm do dado, não de uma lista fixa: estado sem movimento não aparece.
    const ufs = [
      ...new Set([...bruto.bordero, ...bruto.repasse].map((l) => l.uf).filter(Boolean)),
    ].sort();

    const resposta: DiretoriaResponse = {
      payload: montarDashboardDeAgregados(ag, faixas),
      credores,
      opcoesUf: ufs,
      filtros,
      maisAntigoSincronizadoEm: datas[0] ?? null,
      // Distingue "nada sincronizado ainda" de "o filtro não achou nada".
      temAgregados: bruto.bordero.length > 0 || bruto.posicao.length > 0,
    };

    return NextResponse.json(resposta);
  } catch (err) {
    console.error('[diretoria GET]', err);
    return jsonError('Erro ao montar o consolidado.', 500);
  }
}
