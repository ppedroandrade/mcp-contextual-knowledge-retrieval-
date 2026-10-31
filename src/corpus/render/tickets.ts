import type { TicketRecord } from '../../sources/tickets.js';
import { FactSink, slugify, type SourceOutput } from '../model.js';
import type { Rng } from '../random.js';
import { CUSTOMERS, HOWTOS, INCIDENTS } from '../world.js';

export type TicketKind = 'incident' | 'howto' | 'other';

/** Metadados de cada chamado gerado, usados para montar perguntas. */
export interface TicketMeta {
  id: string;
  kind: TicketKind;
  /** Id do incidente, do guia ou do modelo de chamado que originou o chamado. */
  ref: string;
  customer: string;
  createdAt: string;
  subject: string;
  factId: string;
}

const AGENTS = ['Ana (suporte)', 'Bruno (suporte)', 'Carla (suporte)', 'Diego (suporte)'];

const COMPLAINTS: Record<string, string> = {
  'billing-api': 'nossas chamadas à API de cobranças estão falhando',
  'invoice-worker': 'as faturas dos nossos clientes não estão saindo como deveriam',
  'payments-adapter': 'nossos clientes não estão conseguindo pagar com cartão',
  'webhook-dispatcher': 'nosso sistema parou de receber corretamente os eventos de vocês',
  'auth-service': 'nossa equipe não consegue acessar o painel',
  'reporting-service': 'os relatórios que exportamos estão com problema',
  'notification-service': 'nossos clientes estão reclamando dos e-mails de cobrança',
  'customer-portal': 'o painel de vocês está com um comportamento estranho',
};

const OPENINGS = ['Bom dia.', 'Olá, equipe.', 'Prezados,', 'Oi, pessoal.'];

const HOWTO_TICKETS: Record<string, { subject: string; description: string }> = {
  'rotacionar-chave': { subject: 'Troca da chave de integração', description: 'Um desenvolvedor saiu da empresa e precisamos trocar a chave usada pela nossa integração. Qual é o procedimento?' },
  'configurar-webhook': { subject: 'Validação dos eventos recebidos', description: 'Como garantimos que os eventos que chegam no nosso endpoint foram enviados mesmo por vocês?' },
  'limites-requisicao': { subject: 'Erro 429 na rotina noturna', description: 'Nossa rotina noturna de sincronização recebe muitos erros 429. O que devemos fazer?' },
  'ambiente-sandbox': { subject: 'Ambiente para testes de cobrança', description: 'Queremos testar a integração de pagamentos sem cobrar cartões reais. Existe um ambiente para isso?' },
  'reprocessar-fatura': { subject: 'Fatura com status failed', description: 'Uma fatura ficou com status failed depois de um erro. Dá para gerar de novo sem criar outra?' },
  'exportar-relatorios': { subject: 'Exportação anual incompleta', description: 'Precisamos exportar todas as cobranças do ano, mas o arquivo baixado não vem completo.' },
  'configurar-sso': { subject: 'Login com a conta corporativa', description: 'Queremos que a nossa equipe entre no painel com o login da nossa empresa, sem senha separada.' },
  'mudar-plano': { subject: 'Redução de plano', description: 'Queremos passar para um plano menor. A partir de quando a mudança vale?' },
  'atualizar-sdk': { subject: 'Versão antiga do SDK', description: 'Usamos a versão 3 do SDK para Node.js. Precisamos atualizar? O que muda no código?' },
  'consultar-logs': { subject: 'Investigar chamada com erro', description: 'Uma chamada da nossa integração falhou ontem à tarde. Como conseguimos ver o que aconteceu?' },
};

interface OtherTemplate {
  key: string;
  service: string;
  subject: string;
  description: (c: string) => string;
  resolution: (c: string, rng: Rng) => { text: string; value: string };
}

const custSlug = (c: string) => slugify(c).replace(/-/g, '');

const OTHER: OtherTemplate[] = [
  {
    key: 'email-cobranca', service: 'customer-portal', subject: 'Alteração do e-mail de cobrança',
    description: () => 'Precisamos que as faturas passem a ser enviadas para o e-mail do financeiro.',
    resolution: (c) => { const v = `financeiro@${custSlug(c)}.example`; return { text: `E-mail de cobrança alterado para ${v}, conforme solicitado.`, value: v }; },
  },
  {
    key: 'cnpj', service: 'invoice-worker', subject: 'CNPJ errado na fatura',
    description: () => 'A última fatura saiu com o CNPJ da nossa matriz, mas deveria ser o da filial.',
    resolution: (_c, rng) => { const v = `NF-${rng.int(10000, 99999)}`; return { text: `Fatura ${v} cancelada e reemitida com o CNPJ da filial.`, value: v }; },
  },
  {
    key: 'nota-credito', service: 'billing-api', subject: 'Pedido de nota de crédito',
    description: () => 'Fomos cobrados por usuários que já tinham sido desativados. Pedimos o estorno.',
    resolution: (_c, rng) => { const v = `R$ ${rng.int(2, 60) * 10},00`; return { text: `Cobrança indevida confirmada. Nota de crédito de ${v} emitida para abater na próxima fatura.`, value: v }; },
  },
  {
    key: 'usuario-bloqueado', service: 'auth-service', subject: 'Usuário bloqueado no painel',
    description: () => 'Uma colega da equipe financeira não consegue entrar no painel; aparece "conta bloqueada".',
    resolution: (_c, rng) => { const v = rng.pick(['Mariana Costa', 'João Pires', 'Luiza Prado', 'Rafael Nunes', 'Sofia Ramos']); return { text: `A usuária ${v} foi desbloqueada; o bloqueio ocorreu após 5 tentativas de senha incorretas.`, value: v }; },
  },
  {
    key: 'vencimento', service: 'billing-api', subject: 'Mudança do dia de vencimento',
    description: () => 'Podemos mudar o dia de vencimento das nossas faturas para ficar mais perto do nosso fechamento?',
    resolution: (_c, rng) => { const v = `dia ${rng.pick([5, 10, 15, 20, 25])}`; return { text: `Vencimento das faturas alterado para o ${v} de cada mês, a partir do próximo ciclo.`, value: v }; },
  },
  {
    key: 'lgpd', service: 'customer-portal', subject: 'Pedido de exclusão de dados de um titular',
    description: () => 'Recebemos um pedido de um cliente final para apagar os dados dele. Como encaminhamos?',
    resolution: (_c, rng) => { const v = `LGPD-2026-${String(rng.int(1, 999)).padStart(3, '0')}`; return { text: `Pedido registrado com a etiqueta lgpd e encaminhado ao Jurídico sob o protocolo ${v}.`, value: v }; },
  },
  {
    key: 'fatura-sumiu', service: 'customer-portal', subject: 'Fatura não aparece no painel',
    description: () => 'A fatura do mês passado não aparece na lista do painel, mas foi paga.',
    resolution: () => { const v = 'limpar o filtro de datas'; return { text: `A fatura estava fora do período filtrado. Cliente orientado a ${v} da lista de faturas.`, value: v }; },
  },
  {
    key: 'erp', service: 'billing-api', subject: 'Integração com o nosso ERP',
    description: () => 'Vocês têm integração pronta com ERP para lançar as cobranças automaticamente?',
    resolution: (_c, rng) => { const v = rng.pick(['conector ContaFácil ERP', 'conector Lince ERP', 'conector Pórtico ERP']); return { text: `Não há integração nativa. Indicado o ${v}, mantido por parceiro, que usa a API pública.`, value: v }; },
  },
  {
    key: 'limite-usuarios', service: 'billing-api', subject: 'Aumento do número de usuários',
    description: () => 'Atingimos o limite de usuários do plano e precisamos incluir mais pessoas.',
    resolution: (_c, rng) => { const a = rng.pick([5, 10, 15]); const v = `de ${a} para ${a * 2 + 5} usuários`; return { text: `Limite do plano ampliado ${v}, com ajuste pró-rata na próxima fatura.`, value: v }; },
  },
  {
    key: 'webhook-homolog', service: 'webhook-dispatcher', subject: 'Webhook para ambiente de homologação',
    description: () => 'Queremos receber os eventos também no nosso ambiente de homologação.',
    resolution: (c) => { const v = `https://homolog.${custSlug(c)}.example/webhooks`; return { text: `Cadastrada uma segunda URL de webhook (${v}) apenas com eventos de teste.`, value: v }; },
  },
  {
    key: 'moeda', service: 'reporting-service', subject: 'Relatório com moeda errada',
    description: () => 'Os valores do relatório de receita aparecem em dólar, mas cobramos em reais.',
    resolution: () => { const v = 'de USD para BRL'; return { text: `A moeda padrão dos relatórios da conta foi alterada ${v}.`, value: v }; },
  },
  {
    key: 'contato-tecnico', service: 'customer-portal', subject: 'Troca do contato técnico',
    description: () => 'Nosso contato técnico mudou e precisamos atualizar no cadastro.',
    resolution: (_c, rng) => { const v = rng.pick(['Paulo Teixeira', 'Renata Lobo', 'Igor Matos', 'Beatriz Sales']); return { text: `Contato técnico atualizado para ${v}; os alertas de integração passam a ir para essa pessoa.`, value: v }; },
  },
];

interface Draft { meta: Omit<TicketMeta, 'id' | 'factId'>; record: Omit<TicketRecord, 'id'>; factKey: string; factValue: string }

const date = (rng: Rng, month?: number) =>
  `2026-${String(month ?? rng.int(1, 9)).padStart(2, '0')}-${String(rng.int(1, 28)).padStart(2, '0')}`;

/** Chamados de suporte em um único JSON. */
export function renderTickets(rng: Rng): SourceOutput & { tickets: TicketMeta[] } {
  const drafts: Draft[] = [];

  for (const i of INCIDENTS) {
    const customer = rng.pick(CUSTOMERS);
    const hour = rng.int(7, 19);
    const credit = i.severity === 'SEV1' && i.durationMin > 60;
    drafts.push({
      meta: { kind: 'incident', ref: i.id, customer, createdAt: i.date, subject: 'Problema relatado por cliente' },
      record: {
        criado_em: i.date, cliente: customer,
        prioridade: i.severity === 'SEV1' ? 'urgente' : i.severity === 'SEV2' ? 'alta' : 'normal',
        status: 'resolvido', servico: i.service,
        assunto: `Problema: ${COMPLAINTS[i.service]}`,
        descricao: `${rng.pick(OPENINGS)} Desde as ${hour}h ${COMPLAINTS[i.service]}. Podem verificar com urgência?`,
        comentarios: [
          { autor: rng.pick(AGENTS), data: i.date, texto: 'Recebemos o relato e há um incidente aberto. Vamos atualizar por aqui.' },
          { autor: customer, data: i.date, texto: 'Obrigado, aguardamos.' },
        ],
        resolucao: `O problema foi causado pelo incidente ${i.id}, já resolvido pela equipe responsável.${credit ? ' Crédito automático aplicado conforme a política de créditos por indisponibilidade.' : ''}`,
      },
      factKey: 'incidente', factValue: i.id,
    });
  }

  for (const h of HOWTOS) {
    const t = HOWTO_TICKETS[h.id]!;
    for (const customer of rng.shuffle(CUSTOMERS).slice(0, 3)) {
      const d = date(rng);
      drafts.push({
        meta: { kind: 'howto', ref: h.id, customer, createdAt: d, subject: t.subject },
        record: {
          criado_em: d, cliente: customer, prioridade: rng.pick(['normal', 'normal', 'alta'] as const),
          status: 'fechado', servico: h.service, assunto: t.subject,
          descricao: `${rng.pick(OPENINGS)} ${t.description}`,
          comentarios: [{ autor: rng.pick(AGENTS), data: d, texto: 'Obrigado pelo contato; vamos responder em seguida.' }],
          resolucao: `Enviado ao cliente o artigo "${h.title}" da base de conhecimento, com orientação para seguir o passo a passo.`,
        },
        factKey: 'artigo', factValue: h.title,
      });
    }
  }

  const otherCount = 25;
  const used = new Set<string>();
  for (let k = 0; k < otherCount; k++) {
    const tpl = OTHER[k % OTHER.length]!;
    let customer = rng.pick(CUSTOMERS);
    while (used.has(`${tpl.key}|${customer}`)) customer = rng.pick(CUSTOMERS);
    used.add(`${tpl.key}|${customer}`);
    const d = date(rng);
    const res = tpl.resolution(customer, rng);
    drafts.push({
      meta: { kind: 'other', ref: tpl.key, customer, createdAt: d, subject: tpl.subject },
      record: {
        criado_em: d, cliente: customer, prioridade: rng.pick(['normal', 'alta'] as const),
        status: 'fechado', servico: tpl.service, assunto: tpl.subject,
        descricao: `${rng.pick(OPENINGS)} ${tpl.description(customer)}`,
        comentarios: [{ autor: rng.pick(AGENTS), data: d, texto: 'Solicitação recebida; vamos verificar.' }],
        resolucao: res.text,
      },
      factKey: 'resolucao', factValue: res.value,
    });
  }

  // Ordena por data (desempate estável pela ordem de criação) e numera.
  const ordered = drafts.map((d, i) => ({ d, i })).sort((a, b) => a.d.record.criado_em.localeCompare(b.d.record.criado_em) || a.i - b.i);
  const sink = new FactSink('tickets');
  const records: TicketRecord[] = [];
  const tickets: TicketMeta[] = [];
  ordered.forEach(({ d }, n) => {
    const id = `T-${1001 + n}`;
    if (!d.record.resolucao.includes(d.factValue)) throw new Error(`fato ausente em ${id}`);
    const factId = `ticket.${id}.${d.factKey}`;
    sink.add(factId, d.factValue, id, 'resolucao');
    records.push({ id, ...d.record });
    tickets.push({ id, factId, ...d.meta });
  });

  return { files: [{ path: 'tickets/tickets.json', content: JSON.stringify(records, null, 2) + '\n' }], facts: sink.facts, tickets };
}
