import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  contarPerguntasDoDia,
  excedeuCota,
  janelaDoDiaSaoPaulo,
  janelaDoMesSaoPaulo,
  registrarAuditoria,
  resumirResposta,
  type EntradaAuditoria,
} from './agente-relatorios.ts';

/**
 * Dublê do PostgREST: registra a cadeia fluente que a função montou e devolve o
 * que o teste mandar. Zero rede — o que está sob teste aqui é a janela de tempo
 * e a disciplina de falha, não o Supabase.
 */
type ChamadaConta = {
  tabela: string;
  colunas: string;
  opcoes: unknown;
  filtros: { op: string; campo: string; valor: unknown }[];
};

function fakeDbContagem(resultado: { count: number | null; error: unknown }) {
  const chamadas: ChamadaConta[] = [];

  const client = {
    from(tabela: string) {
      const chamada: ChamadaConta = { tabela, colunas: '', opcoes: undefined, filtros: [] };
      chamadas.push(chamada);

      const builder = {
        select(colunas: string, opcoes?: unknown) {
          chamada.colunas = colunas;
          chamada.opcoes = opcoes;
          return builder;
        },
        eq(campo: string, valor: unknown) {
          chamada.filtros.push({ op: 'eq', campo, valor });
          return builder;
        },
        in(campo: string, valor: unknown) {
          chamada.filtros.push({ op: 'in', campo, valor });
          return builder;
        },
        gte(campo: string, valor: unknown) {
          chamada.filtros.push({ op: 'gte', campo, valor });
          return builder;
        },
        lte(campo: string, valor: unknown) {
          chamada.filtros.push({ op: 'lte', campo, valor });
          return builder;
        },
        then(resolve: (r: { count: number | null; error: unknown }) => void) {
          resolve(resultado);
        },
      };

      return builder;
    },
    rpc() {
      throw new Error('rpc não deveria ser chamado neste teste');
    },
  };

  return { client, chamadas };
}

function fakeDbInsert(resultado: { data: unknown; error: unknown }) {
  const gravado: unknown[] = [];

  const client = {
    from() {
      const builder = {
        insert(linha: unknown) {
          gravado.push(linha);
          return builder;
        },
        select() {
          return builder;
        },
        single() {
          return builder;
        },
        then(resolve: (r: { data: unknown; error: unknown }) => void) {
          resolve(resultado);
        },
      };
      return builder;
    },
    rpc() {
      throw new Error('rpc não deveria ser chamado neste teste');
    },
  };

  return { client, gravado };
}

function entradaDeAuditoria(): EntradaAuditoria {
  return {
    tenantId: 'tenant-1',
    credorId: 'credor-1',
    usuarioId: 'usuario-1',
    perguntaTexto: 'evolução da carteira ativa',
    planoExecutado: { tipoRelatorio: 'CARTEIRA_ATIVA' },
    respostaResumo: 'A carteira ativa subiu 12%.',
    status: 'OK',
    tipoRelatorio: 'CARTEIRA_ATIVA',
    modelo: 'gpt-5',
    tokensEntrada: 820,
    tokensSaida: 140,
    custoEstimadoBrl: null,
    duracaoMs: 2310,
  };
}

const umFiltro = (chamada: ChamadaConta, op: string, campo: string) =>
  chamada.filtros.find((f) => f.op === op && f.campo === campo);

describe('janelaDoDiaSaoPaulo', () => {
  it('fim vem depois do início e os dois caem no mesmo dia civil brasileiro', () => {
    const { inicio, fim } = janelaDoDiaSaoPaulo(new Date('2026-11-04T15:00:00.000Z'));

    assert.ok(new Date(fim).getTime() > new Date(inicio).getTime(), 'fim precisa ser depois');

    const diaCivil = (iso: string) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(iso));

    assert.equal(diaCivil(inicio), '2026-11-04');
    assert.equal(diaCivil(fim), '2026-11-04');
    // A janela é o dia inteiro, não um pedaço dele.
    assert.equal(new Date(fim).getTime() - new Date(inicio).getTime(), 86_400_000 - 1);
  });

  it('instante de UTC já no dia seguinte continua no dia civil de São Paulo (virada de mês)', () => {
    // 01/11 01:30 UTC = 31/10 22:30 em São Paulo. Pela janela ingênua em UTC a
    // pergunta cairia em novembro e o credor ganharia uma cota nova às 21h.
    const { inicio, fim } = janelaDoDiaSaoPaulo(new Date('2026-11-01T01:30:00.000Z'));

    assert.equal(inicio, '2026-10-31T03:00:00.000Z');
    assert.equal(fim, '2026-11-01T02:59:59.999Z');
  });

  it('mês civil de São Paulo também respeita a virada', () => {
    const { inicio, fim, mesReferencia } = janelaDoMesSaoPaulo(
      new Date('2026-11-01T01:30:00.000Z'),
    );

    assert.equal(mesReferencia, '2026-10');
    assert.equal(inicio, '2026-10-01T03:00:00.000Z');
    assert.equal(fim, '2026-11-01T02:59:59.999Z');
  });
});

describe('contarPerguntasDoDia', () => {
  it('monta a janela do dia civil brasileiro e devolve o count', async () => {
    const { client, chamadas } = fakeDbContagem({ count: 7, error: null });

    const total = await contarPerguntasDoDia(
      client as never,
      'tenant-1',
      new Date('2026-11-01T01:30:00.000Z'),
    );

    assert.equal(total, 7);
    assert.equal(chamadas.length, 1);

    const chamada = chamadas[0];
    assert.equal(chamada.tabela, 'agente_relatorios_perguntas');
    assert.deepEqual(chamada.opcoes, { count: 'exact', head: true });
    assert.deepEqual(umFiltro(chamada, 'eq', 'tenant_id'), {
      op: 'eq',
      campo: 'tenant_id',
      valor: 'tenant-1',
    });
    assert.equal(umFiltro(chamada, 'gte', 'criado_em')?.valor, '2026-10-31T03:00:00.000Z');
    assert.equal(umFiltro(chamada, 'lte', 'criado_em')?.valor, '2026-11-01T02:59:59.999Z');
  });

  it('REJEITADO não entra na contagem — pergunta sem plano não consumiu cota', async () => {
    const { client, chamadas } = fakeDbContagem({ count: 0, error: null });

    await contarPerguntasDoDia(client as never, 'tenant-1', new Date('2026-11-04T15:00:00.000Z'));

    assert.deepEqual(umFiltro(chamadas[0], 'in', 'status')?.valor, ['OK', 'ERRO']);
  });

  it('erro na contagem libera a pergunta em vez de bloquear o credor', async () => {
    const { client } = fakeDbContagem({ count: null, error: { message: 'timeout' } });

    const total = await contarPerguntasDoDia(client as never, 'tenant-1');

    assert.equal(total, 0);
  });
});

describe('excedeuCota', () => {
  it('limite 2 com 2 usadas já está excedido', () => {
    assert.equal(excedeuCota(2, 2), true);
  });

  it('abaixo do limite passa', () => {
    assert.equal(excedeuCota(1, 2), false);
  });

  it('acima do limite continua excedido', () => {
    assert.equal(excedeuCota(5, 2), true);
  });

  it('limite inválido ou zero não bloqueia ninguém', () => {
    assert.equal(excedeuCota(100, 0), false);
    assert.equal(excedeuCota(100, Number.NaN), false);
  });
});

describe('registrarAuditoria', () => {
  it('devolve o id quando o INSERT funciona', async () => {
    const { client, gravado } = fakeDbInsert({ data: { id: 'auditoria-1' }, error: null });

    const id = await registrarAuditoria(client as never, entradaDeAuditoria());

    assert.equal(id, 'auditoria-1');
    assert.equal(gravado.length, 1);
    assert.equal((gravado[0] as { tenant_id: string }).tenant_id, 'tenant-1');
    assert.equal((gravado[0] as { status: string }).status, 'OK');
  });

  it('INSERT que falha devolve null e não lança — o rastro não derruba a resposta', async () => {
    const { client } = fakeDbInsert({ data: null, error: { message: 'violates foreign key' } });

    const id = await registrarAuditoria(client as never, entradaDeAuditoria());

    assert.equal(id, null);
  });

  it('exceção crua do cliente também vira null', async () => {
    const clienteQueExplode = {
      from() {
        throw new Error('conexão caiu');
      },
      rpc() {
        throw new Error('não usado');
      },
    };

    const id = await registrarAuditoria(clienteQueExplode as never, entradaDeAuditoria());

    assert.equal(id, null);
  });
});

describe('resumirResposta', () => {
  it('texto curto passa inteiro, só normalizando espaço', () => {
    assert.equal(resumirResposta('  A carteira\n  subiu 12%.  '), 'A carteira subiu 12%.');
  });

  it('trunca no limite sem partir palavra e marca o corte', () => {
    const texto = 'palavra '.repeat(200).trim();
    const resumo = resumirResposta(texto, 50);

    assert.ok(resumo.length <= 50, `resumo tem ${resumo.length} caracteres`);
    assert.ok(resumo.endsWith('…'), 'o corte precisa ficar visível');
    assert.ok(!resumo.includes('palav…'), 'não pode cortar no meio da palavra');
    assert.equal(resumo, 'palavra palavra palavra palavra palavra palavra…');
  });

  it('default é 500 caracteres', () => {
    const resumo = resumirResposta('a'.repeat(2000));
    assert.equal(resumo.length, 500);
  });

  it('palavra única maior que o limite é cortada mesmo assim, em vez de sumir', () => {
    const resumo = resumirResposta('x'.repeat(100), 10);
    assert.equal(resumo, `${'x'.repeat(9)}…`);
  });
});
