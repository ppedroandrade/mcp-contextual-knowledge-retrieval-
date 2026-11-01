import type { Question, QuestionStyle } from '../core/types.js';
import { brDate, monthName, type Fact } from './model.js';
import { draft, finalize, HOWTO_LIMIT_ASK, HOWTO_QUESTIONS, OTHER_QUESTIONS, SERVICE_QUESTIONS, type Draft } from './questions.js';
import type { Rng } from './random.js';
import type { TicketMeta } from './render/tickets.js';
import { HOWTOS, INCIDENTS, SERVICES } from './world.js';

/**
 * Conjunto `heldout` (40 perguntas), criado **depois** do congelamento da arquitetura
 * (ADR 010, commit 1a1337a). Usa fatos que o `dev` não usa, sempre que possível, e alterna
 * perguntas `literal` (modelos do `dev`) e `parafraseada` (sem o nome do serviço, o título do
 * guia ou o sintoma do incidente), para medir o ganho da busca semântica quando a pergunta
 * não repete as palavras do corpus (docs/metodologia.md, seção 4).
 */

/** Como uma pessoa descreveria cada serviço sem saber o nome dele (artigo + descrição). */
export const SERVICE_ALIAS: Record<string, { art: 'o' | 'a'; noun: string }> = {
  'billing-api': { art: 'a', noun: 'API pública que os clientes usam para assinaturas e cobranças' },
  'invoice-worker': { art: 'o', noun: 'processo que monta os PDFs das faturas' },
  'payments-adapter': { art: 'a', noun: 'integração com o gateway de cartão' },
  'webhook-dispatcher': { art: 'o', noun: 'componente que avisa os sistemas dos clientes sobre eventos' },
  'auth-service': { art: 'o', noun: 'serviço de login e emissão de tokens' },
  'reporting-service': { art: 'o', noun: 'gerador de relatórios financeiros' },
  'notification-service': { art: 'o', noun: 'serviço que manda e-mails para os clientes' },
  'customer-portal': { art: 'o', noun: 'painel web dos clientes' },
};

type Alias = (typeof SERVICE_ALIAS)[string];
const the = (a: Alias) => `${a.art} ${a.noun}`;
const ofThe = (a: Alias) => `${a.art === 'o' ? 'do' : 'da'} ${a.noun}`;
const byThe = (a: Alias) => `${a.art === 'o' ? 'pelo' : 'pela'} ${a.noun}`;

const SERVICE_PARAPHRASE: Record<string, (a: Alias, v: string) => [string, string]> = {
  healthcheck: (a, v) => [`Que rota eu consulto para saber se ${the(a)} está respondendo normalmente?`, `GET ${v}.`],
  alerta: (a, v) => [`O que precisa acontecer para o monitoramento ${ofThe(a)} chamar alguém?`, `Quando há ${v}.`],
  rollback: (a, v) => [`Se uma versão nova ${ofThe(a)} der problema, como volto para a anterior?`, `${v}.`],
  plantao: (a, v) => [`Onde peço ajuda à equipe de sobreaviso ${ofThe(a)}?`, `Pelo canal ${v}.`],
  time: (a, v) => [`Que equipe responde ${byThe(a)}?`, `${v}.`],
  stack: (a, v) => [`Que linguagem e framework usa ${the(a)}?`, `${v}.`],
  dados: (a, v) => [`Onde ficam guardadas as informações ${ofThe(a)}?`, `Em ${v}.`],
  slo: (a, v) => [`Que compromisso de disponibilidade ou de prazo tem ${the(a)}?`, `${v}.`],
  retry: (a, v) => [`O que faz ${the(a)} quando uma operação falha de forma passageira?`, `${v}.`],
};

/** O que perguntar sobre o limite de cada guia, sem as palavras do artigo. */
const HOWTO_LIMIT_PARAPHRASE: Record<string, string> = {
  'rotacionar-chave': 'por quanto tempo uma credencial vale',
  'configurar-webhook': 'quanto tempo o sistema do cliente tem para confirmar o recebimento',
  'limites-requisicao': 'quantas chamadas por minuto são permitidas no padrão',
  'ambiente-sandbox': 'que cartão de teste faz o pagamento ser negado',
  'reprocessar-fatura': 'quantas novas tentativas são permitidas',
  'exportar-relatorios': 'qual é o tamanho máximo do download direto',
  'configurar-sso': 'que assinatura é exigida',
  'mudar-plano': 'quando a redução do pacote começa a valer',
  'atualizar-sdk': 'qual é a versão mais antiga ainda atendida',
  'consultar-logs': 'por quanto tempo o histórico fica visível no painel',
};

export const HOWTO_PARAPHRASE: Record<string, string> = {
  'rotacionar-chave.validade': 'Uma credencial de acesso à API vale por quanto tempo?',
  'rotacionar-chave.menu': 'Onde, no painel, eu crio uma credencial nova para integrar com a API?',
  'configurar-webhook.timeout': 'Quanto tempo meu servidor tem para confirmar que recebeu uma notificação de evento?',
  'configurar-webhook.cabecalho': 'Em que campo HTTP vem a prova de que a notificação de evento saiu mesmo da Orbital?',
  'limites-requisicao.limite': 'Quantas chamadas por minuto uma integração pode fazer sem ser barrada, no padrão?',
  'limites-requisicao.cabecalho': 'Depois de ser barrado por excesso de chamadas, onde vejo quanto tempo aguardar?',
  'ambiente-sandbox.cartao-recusa': 'No ambiente de testes, que cartão faz o pagamento ser negado?',
  'ambiente-sandbox.url': 'Qual é o endereço base para testar a integração sem cobrar de verdade?',
  'reprocessar-fatura.maximo': 'Quantas vezes dá para tentar de novo uma cobrança cujo documento deu erro?',
  'reprocessar-fatura.endpoint': 'Que rota da API eu chamo para tentar de novo um documento de cobrança que deu erro?',
  'exportar-relatorios.limite-linhas': 'Até que tamanho consigo baixar os números financeiros direto, sem pedir por e-mail?',
  'exportar-relatorios.formato': 'Que botão eu clico para baixar os números financeiros?',
  'configurar-sso.plano': 'Que assinatura o cliente precisa ter para entrar com a conta corporativa?',
  'configurar-sso.acs': 'Que endereço de retorno o cliente deve cadastrar no provedor de identidade corporativo?',
  'mudar-plano.downgrade': 'Se o cliente reduzir o que contratou, a partir de quando isso vale?',
  'mudar-plano.endpoint': 'Que rota da API troca o pacote contratado?',
  'atualizar-sdk.versao-minima': 'Qual a versão mais antiga da biblioteca oficial para Node que ainda tem suporte?',
  'atualizar-sdk.troca': 'O que usar no lugar de client.invoices.list na biblioteca nova?',
  'consultar-logs.retencao': 'Por quanto tempo o painel mostra o histórico de chamadas à API?',
  'consultar-logs.filtro': 'Que campo uso para encontrar uma chamada específica no histórico?',
};

const OTHER_PARAPHRASE: Record<string, (c: string) => string> = {
  'email-cobranca': (c) => `Que endereço passou a receber as cobranças do cliente ${c}?`,
  cnpj: (c) => `Que documento de cobrança foi refeito para o cliente ${c} por erro no cadastro da empresa?`,
  'nota-credito': (c) => `Qual foi o valor devolvido em crédito ao cliente ${c}?`,
  'usuario-bloqueado': (c) => `Quem do cliente ${c} teve o acesso liberado de novo?`,
  vencimento: (c) => `Que dia passou a ser a data de pagamento do cliente ${c}?`,
  lgpd: (c) => `Que número de protocolo recebeu o cliente ${c} ao pedir para apagar os seus dados?`,
  erp: (c) => `Que sistema de gestão foi recomendado para o cliente ${c} integrar?`,
  'limite-usuarios': (c) => `O que mudou na quantidade de pessoas que o cliente ${c} pode cadastrar?`,
  'webhook-homolog': (c) => `Que endereço de testes o cliente ${c} cadastrou para receber notificações?`,
  'contato-tecnico': (c) => `Quem virou a pessoa de referência técnica do cliente ${c}?`,
};

/** Perguntas sem resposta no corpus; os termos centrais são conferidos por teste. */
export const HELDOUT_UNANSWERABLE: [string, string, string][] = [
  ['Qual é o endpoint de saúde do tax-service?', 'O corpus não descreve nenhum serviço chamado tax-service.', 'tax-service'],
  ['Quem estava de plantão no incidente de 03/03/2026?', 'Não há incidente registrado nessa data.', '03/03/2026'],
  ['Qual versão do Kubernetes roda em produção?', 'O corpus não informa a versão do Kubernetes.', 'Kubernetes'],
  ['Quanto custa por mês o plano Enterprise?', 'O corpus não informa o preço dos planos.', 'preço'],
];

/** 18 de fonte única, 18 multifonte e 4 sem resposta; literal e parafraseada alternadas. */
export function buildHeldoutQuestions(rng: Rng, facts: Map<string, Fact>, tickets: TicketMeta[], dev: Question[]): Question[] {
  const v = (id: string) => facts.get(id)?.value ?? (() => { throw new Error(`fato inexistente: ${id}`); })();
  const usedByDev = new Set(dev.flatMap((q) => q.factIds));
  const devTexts = new Set(dev.map((q) => q.text));
  const fresh = (...ids: string[]) => ids.every((id) => !usedByDev.has(id));
  const drafts: Draft[] = [];
  let n = 0;
  /** Alterna o estilo dentro de cada grupo, começando por literal. */
  const style = (): QuestionStyle => (n++ % 2 === 0 ? 'literal' : 'parafraseada');
  const add = (d: Draft, s: QuestionStyle) => drafts.push({ ...d, style: s });

  // Fonte única: wiki, serviços (7).
  n = 0;
  const svcPairs = rng.shuffle(SERVICES.flatMap((s) => Object.keys(SERVICE_QUESTIONS).map((f) => [s, f] as const)))
    .filter(([s, f]) => fresh(`svc.${s.id}.${f}`));
  const seenSvc = new Set<string>();
  for (const [s, f] of svcPairs) {
    if (drafts.length >= 7) break;
    if (seenSvc.has(s.id)) continue; // um campo por serviço, para variar
    seenSvc.add(s.id);
    const id = `svc.${s.id}.${f}`;
    const st = style();
    const [text, answer] = st === 'literal' ? SERVICE_QUESTIONS[f]!(s.name, v(id)) : SERVICE_PARAPHRASE[f]!(SERVICE_ALIAS[s.id]!, v(id));
    add(draft('single-source', text, [id], answer), st);
  }

  // Fonte única: wiki, guias (5).
  n = 0;
  for (const key of rng.shuffle(Object.keys(HOWTO_QUESTIONS)).filter((k) => fresh(`howto.${k}`)).slice(0, 5)) {
    const st = style();
    add(draft('single-source', st === 'literal' ? HOWTO_QUESTIONS[key]! : HOWTO_PARAPHRASE[key]!, [`howto.${key}`], `${v(`howto.${key}`)}.`), st);
  }

  // Fonte única: incidentes (3) e chamados (3).
  n = 0;
  const incFresh = rng.shuffle(INCIDENTS).filter((i) => fresh(`inc.${i.id}.causa`, `inc.${i.id}.acao`, `inc.${i.id}.duracao`, `inc.${i.id}.servico`));
  for (const [k, i] of incFresh.slice(0, 3).entries()) {
    const st = style();
    const a = SERVICE_ALIAS[i.service]!;
    const d = brDate(i.date);
    const m = monthName(i.date);
    if (k === 0) add(draft('single-source', st === 'literal' ? `O que causou o problema de ${i.symptom} em ${m} de 2026?` : `Por que ${the(a)} teve problema em ${d}?`, [`inc.${i.id}.causa`], `${i.rootCause}.`), st);
    else if (k === 1) add(draft('single-source', st === 'literal' ? `Que ação corretiva foi definida depois que houve ${i.symptom} em ${m}?` : `O que ficou combinado para a falha ${ofThe(a)} em ${d} não se repetir?`, [`inc.${i.id}.acao`], `${i.correctiveAction}.`), st);
    else add(draft('single-source', st === 'literal' ? `Quanto tempo durou o incidente em que houve ${i.symptom}?` : `Por quanto tempo ${the(a)} ficou com problema em ${d}?`, [`inc.${i.id}.duracao`], `${i.durationMin} minutos.`), st);
  }
  n = 0;
  const constant = new Set(['fatura-sumiu', 'moeda']);
  for (const t of rng.shuffle(tickets.filter((t) => t.kind === 'other' && !constant.has(t.ref) && fresh(t.factId))).slice(0, 3)) {
    const st = style();
    add(draft('single-source', st === 'literal' ? OTHER_QUESTIONS[t.ref]!(t.customer) : OTHER_PARAPHRASE[t.ref]!(t.customer), [t.factId], `${v(t.factId)}.`), st);
  }

  // Multifonte: incidente + wiki (6): incidentes cujo serviço afetado o dev não perguntou e que o
  // bloco acima não usou (os fatos de causa e ação podem estar no dev; a pergunta é outra).
  n = 0;
  const docFields = ['healthcheck', 'rollback', 'plantao', 'time'] as const;
  const usedInc = new Set(incFresh.slice(0, 3).map((i) => i.id));
  const incForWiki = rng.shuffle(INCIDENTS).filter((i) => !usedInc.has(i.id) && fresh(`inc.${i.id}.servico`));
  for (const [k, i] of incForWiki.slice(0, 6).entries()) {
    const field = docFields[k % docFields.length]!;
    const fid = `svc.${i.service}.${field}`;
    const st = style();
    const m = monthName(i.date);
    const d = brDate(i.date);
    const q = st === 'literal'
      ? {
        healthcheck: `Durante o incidente em que houve ${i.symptom}, em ${m}, qual endpoint mostraria a saúde do serviço afetado?`,
        rollback: `Se o incidente de ${m} em que houve ${i.symptom} tivesse vindo de um deploy, qual comando faria o rollback do serviço afetado?`,
        plantao: `Por qual canal deveria ser acionado o plantão do serviço afetado no incidente em que houve ${i.symptom}?`,
        time: `Qual time é responsável pelo serviço que teve ${i.symptom} em ${m}?`,
      }[field]
      : {
        healthcheck: `Na falha de ${d}, que rota mostraria se o componente afetado tinha voltado?`,
        rollback: `Se a falha de ${d} tivesse vindo de uma versão nova, como voltar o componente afetado para a anterior?`,
        plantao: `Onde chamar a equipe de sobreaviso do componente que falhou em ${d}?`,
        time: `Que equipe cuida do componente que falhou em ${d}?`,
      }[field];
    add(draft('multi-source', q, [`inc.${i.id}.servico`, fid], `O serviço afetado foi o ${i.service}; ${v(fid)}.`), st);
  }

  // Multifonte: chamado + incidente (6).
  n = 0;
  const byCustomerDate = new Map<string, number>();
  for (const t of tickets) byCustomerDate.set(`${t.customer}|${t.createdAt}`, (byCustomerDate.get(`${t.customer}|${t.createdAt}`) ?? 0) + 1);
  const incTickets = rng.shuffle(tickets.filter((t) => t.kind === 'incident' && byCustomerDate.get(`${t.customer}|${t.createdAt}`) === 1 && fresh(t.factId)));
  for (const t of incTickets.slice(0, 6)) {
    const incId = v(t.factId);
    const st = style();
    const d = brDate(t.createdAt);
    add(draft('multi-source',
      st === 'literal' ? `Qual foi a causa técnica do problema que o cliente ${t.customer} relatou em ${d}?` : `O que estava quebrado por trás da reclamação do cliente ${t.customer} em ${d}?`,
      [t.factId, `inc.${incId}.causa`],
      `O chamado foi ligado ao incidente ${incId}, cuja causa raiz foi: ${v(`inc.${incId}.causa`)}.`), st);
  }

  // Multifonte: chamado + wiki (6), um chamado por guia.
  n = 0;
  const seenGuides = new Set<string>();
  const guideTickets = rng.shuffle(tickets.filter((t) => t.kind === 'howto' && fresh(t.factId) && byCustomerDate.get(`${t.customer}|${t.createdAt}`) === 1))
    .filter((t) => !seenGuides.has(t.ref) && seenGuides.add(t.ref));
  for (const t of guideTickets.slice(0, 6)) {
    const h = HOWTOS.find((x) => x.id === t.ref)!;
    const lim = `howto.${h.id}.${h.limitFact.key}`;
    const st = style();
    add(draft('multi-source',
      st === 'literal'
        ? `O cliente ${t.customer} abriu um chamado sobre "${t.subject}". Qual artigo foi enviado e, segundo ele, ${HOWTO_LIMIT_ASK[h.id]}?`
        : `Que artigo da base mandaram para o cliente ${t.customer} no atendimento de ${brDate(t.createdAt)}, e o que ele diz sobre ${HOWTO_LIMIT_PARAPHRASE[h.id]}?`,
      [t.factId, lim],
      `Foi enviado o artigo "${h.title}"; ${v(lim)}.`), st);
  }

  // Sem resposta (4).
  for (const [text, answer] of HELDOUT_UNANSWERABLE) drafts.push(draft('unanswerable', text, [], answer));

  for (const d of drafts) if (devTexts.has(d.text)) throw new Error(`pergunta do heldout repete o dev: ${d.text}`);
  return finalize(rng.shuffle(drafts), facts, 'heldout', 'h');
}
