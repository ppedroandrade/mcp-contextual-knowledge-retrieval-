import type { Question, QuestionSet, QuestionType } from '../core/types.js';
import { brDate, monthName, type Fact } from './model.js';
import type { Rng } from './random.js';
import type { TicketMeta } from './render/tickets.js';
import { HOWTOS, INCIDENTS, SERVICES } from './world.js';

export type Draft = Omit<Question, 'id' | 'set' | 'sources' | 'relevantDocIds' | 'evidence'>;

/** Cada pergunta cita fatos; evidências, documentos e fontes saem dos fatos, não de anotação manual. */
export function finalize(drafts: Draft[], facts: Map<string, Fact>, set: QuestionSet, prefix: string): Question[] {
  return drafts.map((d, i) => {
    const used = d.factIds.map((id) => {
      const f = facts.get(id);
      if (!f) throw new Error(`fato inexistente: ${id}`);
      return f;
    });
    const units = [...new Set(used.map((f) => f.unitId))];
    return {
      id: `${prefix}${String(i + 1).padStart(3, '0')}`,
      text: d.text,
      type: d.type,
      set,
      sources: [...new Set(used.map((f) => f.source))],
      relevantDocIds: [...new Set(used.map((f) => f.docId))],
      evidence: units.map((u) => [u]),
      factIds: d.factIds,
      referenceAnswer: d.referenceAnswer,
      ...(d.style ? { style: d.style } : {}),
    };
  });
}

export const draft = (type: QuestionType, text: string, factIds: string[], referenceAnswer: string): Draft =>
  ({ type, text, factIds, referenceAnswer });

export const SERVICE_QUESTIONS: Record<string, (svc: string, v: string) => [string, string]> = {
  healthcheck: (s, v) => [`Qual endpoint devo chamar para verificar se o ${s} está saudável?`, `GET ${v}.`],
  alerta: (s, v) => [`Em que situação dispara o alerta principal do ${s}?`, `Quando há ${v}.`],
  rollback: (s, v) => [`Qual comando desfaz um deploy problemático do ${s}?`, `${v}.`],
  plantao: (s, v) => [`Por qual canal eu aciono o plantão responsável pelo ${s}?`, `Pelo canal ${v}.`],
  time: (s, v) => [`Qual time é dono do ${s}?`, `${v}.`],
  stack: (s, v) => [`Em que tecnologia o ${s} foi construído?`, `${v}.`],
  dados: (s, v) => [`Onde o ${s} armazena seus dados?`, `Em ${v}.`],
  slo: (s, v) => [`Qual é a meta de nível de serviço do ${s}?`, `${v}.`],
  retry: (s, v) => [`Como o ${s} lida com novas tentativas em falhas temporárias?`, `${v}.`],
};

export const HOWTO_QUESTIONS: Record<string, string> = {
  'rotacionar-chave.validade': 'Depois de quanto tempo uma chave de API expira?',
  'rotacionar-chave.menu': 'Em qual menu do portal se gera uma nova chave de API?',
  'configurar-webhook.timeout': 'Qual é o tempo máximo para o sistema do cliente responder a um webhook?',
  'configurar-webhook.cabecalho': 'Em qual cabeçalho vem a assinatura dos webhooks?',
  'limites-requisicao.limite': 'Quantas requisições por minuto uma chave de API pode fazer no limite padrão?',
  'limites-requisicao.cabecalho': 'Qual cabeçalho indica quanto tempo esperar depois de um erro 429?',
  'ambiente-sandbox.cartao-recusa': 'Que número de cartão uso no sandbox para simular uma recusa?',
  'ambiente-sandbox.url': 'Qual é o endereço da API de sandbox?',
  'reprocessar-fatura.maximo': 'Quantas vezes posso reprocessar a mesma fatura?',
  'reprocessar-fatura.endpoint': 'Qual chamada da API reprocessa uma fatura com falha?',
  'exportar-relatorios.limite-linhas': 'Qual é o tamanho máximo de uma exportação direta de relatório?',
  'exportar-relatorios.formato': 'Qual botão uso para baixar um relatório financeiro?',
  'configurar-sso.plano': 'Qual plano o cliente precisa ter para usar login único com SAML?',
  'configurar-sso.acs': 'Qual URL de ACS devo passar ao cliente que está configurando SSO?',
  'mudar-plano.downgrade': 'Quando um downgrade de plano começa a valer?',
  'mudar-plano.endpoint': 'Qual chamada da API muda o plano de uma assinatura?',
  'atualizar-sdk.versao-minima': 'Qual é a versão mínima suportada do SDK para Node.js?',
  'atualizar-sdk.troca': 'Qual método substitui client.invoices.list no SDK atual?',
  'consultar-logs.retencao': 'Por quantos dias os logs de requisições ficam visíveis no portal?',
  'consultar-logs.filtro': 'Por qual campo filtro os logs para achar uma chamada específica?',
};

export const HOWTO_LIMIT_ASK: Record<string, string> = {
  'rotacionar-chave': 'em quanto tempo as chaves expiram',
  'configurar-webhook': 'em quanto tempo o sistema do cliente precisa responder',
  'limites-requisicao': 'qual é o limite padrão de requisições',
  'ambiente-sandbox': 'qual cartão de teste simula uma recusa',
  'reprocessar-fatura': 'quantas vezes a fatura pode ser reprocessada',
  'exportar-relatorios': 'até quantas linhas vai a exportação direta',
  'configurar-sso': 'em qual plano o recurso está disponível',
  'mudar-plano': 'quando a redução de plano passa a valer',
  'atualizar-sdk': 'qual é a versão mínima suportada',
  'consultar-logs': 'por quanto tempo os logs ficam no portal',
};

export const OTHER_QUESTIONS: Record<string, (c: string) => string> = {
  'email-cobranca': (c) => `Para qual e-mail passaram a ir as faturas do cliente ${c}?`,
  cnpj: (c) => `Qual fatura foi reemitida para o cliente ${c} por causa do CNPJ errado?`,
  'nota-credito': (c) => `De quanto foi a nota de crédito emitida para o cliente ${c}?`,
  'usuario-bloqueado': (c) => `Qual usuária do cliente ${c} foi desbloqueada no painel?`,
  vencimento: (c) => `Para qual dia foi mudado o vencimento das faturas do cliente ${c}?`,
  lgpd: (c) => `Qual é o protocolo do pedido de exclusão de dados aberto pelo cliente ${c}?`,
  'fatura-sumiu': (c) => `O que o cliente ${c} precisou fazer para ver a fatura que não aparecia no painel?`,
  erp: (c) => `Que integração com ERP foi indicada ao cliente ${c}?`,
  'limite-usuarios': (c) => `Como ficou o limite de usuários do plano do cliente ${c}?`,
  'webhook-homolog': (c) => `Qual URL de homologação foi cadastrada para os webhooks do cliente ${c}?`,
  moeda: (c) => `O que foi mudado na moeda dos relatórios do cliente ${c}?`,
  'contato-tecnico': (c) => `Quem passou a ser o contato técnico do cliente ${c}?`,
};

const UNANSWERABLE: [string, string][] = [
  ['Qual é o endpoint de saúde do ledger-service?', 'O corpus não descreve nenhum serviço chamado ledger-service.'],
  ['Qual foi a causa raiz do incidente de 12/10/2026?', 'Não há incidente registrado nessa data.'],
  ['Qual é o limite de requisições por minuto da API GraphQL?', 'O corpus não menciona uma API GraphQL.'],
  ['Qual time mantém o aplicativo móvel da Orbital?', 'O corpus não menciona aplicativo móvel.'],
  ['Quantas pessoas trabalham no Time Dados?', 'O corpus não informa o tamanho dos times.'],
  [`Qual taxa o gateway cobra por transação aprovada?`, 'O corpus não informa as taxas do gateway.'],
];

const POLICY_QUESTIONS: Record<string, string> = {
  'POL-01.resposta-sev1': 'Em quanto tempo o plantão precisa dar a primeira resposta a um incidente SEV1?',
  'POL-01.prazo-postmortem': 'Qual é o prazo para publicar o postmortem de um incidente SEV2?',
  'POL-02.tamanho-minimo': 'Qual é o tamanho mínimo de senha para colaboradores?',
  'POL-02.mfa-producao': 'Que tipo de segundo fator é exigido de quem acessa a produção?',
  'POL-03.faturas': 'Por quanto tempo os dados de faturas são guardados?',
  'POL-03.logs': 'Por quanto tempo os logs de aplicação são mantidos?',
  'POL-04.prazo-titular': 'Qual é o prazo para responder a um pedido de exclusão de dados pessoais?',
  'POL-04.canal': 'Por qual e-mail chegam os pedidos de titulares de dados?',
  'POL-05.troca': 'Quando acontece a troca de plantão?',
  'POL-05.folga': 'O que a pessoa ganha por uma semana de plantão?',
  'POL-06.periodicidade': 'Com que frequência os acessos à produção são revisados?',
  'POL-06.revogacao': 'Em quanto tempo os acessos de quem sai da empresa são revogados?',
  'POL-07.congelamento': 'Em que período não são feitos deploys em produção?',
  'POL-07.aprovacao-pagamentos': 'Quantas aprovações uma mudança em serviço de pagamento exige?',
  'POL-08.elegibilidade': 'Qual duração mínima de um SEV1 dá direito a crédito automático?',
  'POL-08.valor': 'De quanto é o crédito por indisponibilidade?',
  'POL-09.cartao': 'Como são classificados os dados de cartão?',
  'POL-10.regra': 'Posso usar dados reais de clientes em ambiente de teste?',
  'POL-10.excecao': 'Quem aprova a anonimização de dados para uso em testes?',
  'POL-11.retencao-backup': 'Por quanto tempo os backups dos bancos de produção são guardados?',
  'POL-11.rto': 'Qual é a meta de tempo de recuperação (RTO) dos bancos?',
  'POL-12.canal': 'Onde é publicada a comunicação oficial sobre incidentes?',
  'POL-13.aviso': 'Com quanto tempo de antecedência uma versão da API é descontinuada?',
  'POL-13.v1': 'Quando a versão v1 da API será desligada?',
  'POL-14.duracao': 'Por quanto tempo vale o acesso temporário de um fornecedor?',
  'POL-15.urgente': 'Qual é o prazo de primeira resposta para chamados urgentes?',
  'POL-15.enterprise': 'Em que horário clientes Enterprise têm suporte?',
};

/** Conjunto `dev`: 30 de fonte única, 24 multifonte e 6 sem resposta. */
export function buildDevQuestions(rng: Rng, facts: Map<string, Fact>, tickets: TicketMeta[]): Question[] {
  const v = (id: string) => facts.get(id)?.value ?? (() => { throw new Error(`fato inexistente: ${id}`); })();
  const drafts: Draft[] = [];

  // Fonte única: wiki (6 de serviços + 6 de guias).
  const serviceFields = Object.keys(SERVICE_QUESTIONS);
  const svcPairs = rng.shuffle(SERVICES.flatMap((s) => serviceFields.map((f) => [s, f] as const))).slice(0, 6);
  for (const [s, field] of svcPairs) {
    const id = `svc.${s.id}.${field}`;
    const [text, answer] = SERVICE_QUESTIONS[field]!(s.name, v(id));
    drafts.push(draft('single-source', text, [id], answer));
  }
  for (const key of rng.shuffle(Object.keys(HOWTO_QUESTIONS)).slice(0, 6)) {
    const id = `howto.${key}`;
    drafts.push(draft('single-source', HOWTO_QUESTIONS[key]!, [id], `${v(id)}.`));
  }

  // Fonte única: incidentes (9).
  const incPick = rng.shuffle(INCIDENTS);
  for (const [k, i] of incPick.slice(0, 9).entries()) {
    const m = monthName(i.date);
    if (k % 3 === 0) drafts.push(draft('single-source', `O que causou o problema de ${i.symptom} em ${m} de 2026?`, [`inc.${i.id}.causa`], `${i.rootCause}.`));
    else if (k % 3 === 1) drafts.push(draft('single-source', `Que ação corretiva foi definida depois que houve ${i.symptom} em ${m}?`, [`inc.${i.id}.acao`], `${i.correctiveAction}.`));
    else drafts.push(draft('single-source', `Quanto tempo durou o incidente em que houve ${i.symptom}?`, [`inc.${i.id}.duracao`], `${i.durationMin} minutos.`));
  }

  // Fonte única: chamados (9).
  // Modelos com resposta igual para todos os clientes ficam só como distratores.
  const constant = new Set(['fatura-sumiu', 'moeda']);
  for (const t of rng.shuffle(tickets.filter((t) => t.kind === 'other' && !constant.has(t.ref))).slice(0, 9)) {
    drafts.push(draft('single-source', OTHER_QUESTIONS[t.ref]!(t.customer), [t.factId], `${v(t.factId)}.`));
  }

  // Multifonte: incidente + wiki (8).
  const docFields = ['healthcheck', 'rollback', 'plantao', 'time'] as const;
  for (const [k, i] of incPick.slice(9, 17).entries()) {
    const field = docFields[k % docFields.length]!;
    const svc = i.service;
    const fid = `svc.${svc}.${field}`;
    const m = monthName(i.date);
    const base = `inc.${i.id}.servico`;
    const q = {
      healthcheck: `Durante o incidente em que houve ${i.symptom}, em ${m}, qual endpoint mostraria a saúde do serviço afetado?`,
      rollback: `Se o incidente de ${m} em que houve ${i.symptom} tivesse vindo de um deploy, qual comando faria o rollback do serviço afetado?`,
      plantao: `Por qual canal deveria ser acionado o plantão do serviço afetado no incidente em que houve ${i.symptom}?`,
      time: `Qual time é responsável pelo serviço que teve ${i.symptom} em ${m}?`,
    }[field];
    drafts.push(draft('multi-source', q, [base, fid], `O serviço afetado foi o ${svc}; ${v(fid)}.`));
  }

  // Multifonte: chamado + incidente (8).
  const byCustomerDate = new Map<string, number>();
  for (const t of tickets) byCustomerDate.set(`${t.customer}|${t.createdAt}`, (byCustomerDate.get(`${t.customer}|${t.createdAt}`) ?? 0) + 1);
  const incTickets = rng.shuffle(tickets.filter((t) => t.kind === 'incident' && byCustomerDate.get(`${t.customer}|${t.createdAt}`) === 1));
  for (const t of incTickets.slice(0, 8)) {
    const incId = v(t.factId);
    drafts.push(draft('multi-source',
      `Qual foi a causa técnica do problema que o cliente ${t.customer} relatou em ${brDate(t.createdAt)}?`,
      [t.factId, `inc.${incId}.causa`],
      `O chamado foi ligado ao incidente ${incId}, cuja causa raiz foi: ${v(`inc.${incId}.causa`)}.`));
  }

  // Multifonte: chamado + wiki (8).
  const seenGuides = new Set<string>();
  const guideTickets = rng.shuffle(tickets.filter((t) => t.kind === 'howto')).filter((t) => !seenGuides.has(t.ref) && seenGuides.add(t.ref));
  for (const t of guideTickets.slice(0, 8)) {
    const h = HOWTOS.find((x) => x.id === t.ref)!;
    const lim = `howto.${h.id}.${h.limitFact.key}`;
    drafts.push(draft('multi-source',
      `O cliente ${t.customer} abriu um chamado sobre "${t.subject}". Qual artigo foi enviado e, segundo ele, ${HOWTO_LIMIT_ASK[h.id]}?`,
      [t.factId, lim],
      `Foi enviado o artigo "${h.title}"; ${v(lim)}.`));
  }

  // Sem resposta (6).
  for (const [text, answer] of UNANSWERABLE) drafts.push(draft('unanswerable', text, [], answer));

  return finalize(rng.shuffle(drafts), facts, 'dev', 'q');
}

/** Perguntas da 4ª fonte (políticas), usadas na avaliação da H3. */
export function buildPolicyQuestions(rng: Rng, facts: Map<string, Fact>): Question[] {
  const v = (id: string) => facts.get(id)!.value;
  const drafts: Draft[] = [];

  for (const key of rng.shuffle(Object.keys(POLICY_QUESTIONS)).slice(0, 10)) {
    const id = `pol.${key}`;
    drafts.push(draft('single-source', POLICY_QUESTIONS[key]!, [id], `${v(id)}.`));
  }

  const sev1 = INCIDENTS.filter((i) => i.severity === 'SEV1');
  for (const i of rng.shuffle(sev1).slice(0, 3)) {
    drafts.push(draft('multi-source',
      `Qual foi a severidade do incidente em que houve ${i.symptom}, e em quanto tempo o plantão deveria dar a primeira resposta?`,
      [`inc.${i.id}.severidade`, 'pol.POL-01.resposta-sev1'],
      `${i.severity}; a primeira resposta deveria ocorrer em até ${v('pol.POL-01.resposta-sev1')}.`));
  }

  const long = rng.pick(sev1.filter((i) => i.durationMin > 60));
  const short = rng.pick(sev1.filter((i) => i.durationMin <= 60));
  for (const i of [long, short]) {
    const eligible = i.durationMin > 60;
    drafts.push(draft('multi-source',
      `Os clientes afetados pelo incidente em que houve ${i.symptom} tinham direito a crédito automático? De quanto?`,
      [`inc.${i.id}.severidade`, `inc.${i.id}.duracao`, 'pol.POL-08.elegibilidade', ...(eligible ? ['pol.POL-08.valor'] : [])],
      eligible
        ? `Sim. Foi um SEV1 de ${i.durationMin} minutos (mais de 60 minutos), então o crédito é de ${v('pol.POL-08.valor')}.`
        : `Não. Foi um SEV1 de ${i.durationMin} minutos, abaixo dos 60 minutos exigidos pela política.`));
  }

  return finalize(rng.shuffle(drafts), facts, 'policies', 'p');
}
