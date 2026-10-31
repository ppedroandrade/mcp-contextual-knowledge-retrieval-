/**
 * "Mundo" da empresa fictícia Orbital Software. Todas as fontes derivam daqui, o que
 * mantém o corpus coerente entre fontes. Todos os nomes, valores e eventos são fictícios.
 */

export const COMPANY = 'Orbital Software';
export const PRODUCT = 'Orbital Billing';
export const GATEWAY = 'PagaFácil';

export interface Service {
  id: string;
  name: string;
  purpose: string;
  team: string;
  stack: string;
  datastore: string;
  healthcheck: string;
  slo: string;
  retry: string;
  rollback: string;
  alert: string;
  oncallChannel: string;
}

export const SERVICES: Service[] = [
  {
    id: 'billing-api',
    name: 'billing-api',
    purpose: 'expõe a API pública de assinaturas, planos e cobranças',
    team: 'Time Faturamento',
    stack: 'Node.js 22 com Fastify',
    datastore: 'PostgreSQL 16 (banco billing, réplica de leitura em us-east)',
    healthcheck: '/health/billing',
    slo: '99,9% de disponibilidade mensal',
    retry: 'até 3 tentativas com backoff exponencial começando em 200 ms',
    rollback: 'orbctl rollback billing-api --to previous',
    alert: 'latência p95 acima de 800 ms por 5 minutos',
    oncallChannel: '#oncall-faturamento',
  },
  {
    id: 'invoice-worker',
    name: 'invoice-worker',
    purpose: 'gera as faturas em PDF e calcula impostos de forma assíncrona',
    team: 'Time Faturamento',
    stack: 'Go 1.23',
    datastore: 'fila RabbitMQ invoices.generate e bucket de objetos orbital-invoices',
    healthcheck: '/health/invoice-worker',
    slo: '99,5% das faturas geradas em até 10 minutos',
    retry: 'até 5 tentativas; depois a mensagem vai para a fila invoices.dlq',
    rollback: 'orbctl rollback invoice-worker --to previous --drain-queue',
    alert: 'mais de 500 mensagens na fila invoices.dlq',
    oncallChannel: '#oncall-faturamento',
  },
  {
    id: 'payments-adapter',
    name: 'payments-adapter',
    purpose: `integra o ${PRODUCT} ao gateway de pagamentos ${GATEWAY}`,
    team: 'Time Pagamentos',
    stack: 'Kotlin com Spring Boot 3',
    datastore: 'PostgreSQL 16 (banco payments) e cache Redis para idempotência',
    healthcheck: '/actuator/health/payments',
    slo: '99,95% de disponibilidade mensal',
    retry: 'nenhuma nova tentativa automática em cobranças; timeout de 10 segundos por chamada ao gateway',
    rollback: 'orbctl rollback payments-adapter --to previous --require-approval',
    alert: 'taxa de recusa técnica acima de 2% em 10 minutos',
    oncallChannel: '#oncall-pagamentos',
  },
  {
    id: 'webhook-dispatcher',
    name: 'webhook-dispatcher',
    purpose: 'entrega os eventos de webhook aos sistemas dos clientes',
    team: 'Time Integrações',
    stack: 'Node.js 22',
    datastore: 'Redis 7 (fila de entregas pendentes)',
    healthcheck: '/health/webhooks',
    slo: '99% dos eventos entregues em até 1 minuto',
    retry: 'até 8 tentativas distribuídas em 24 horas',
    rollback: 'orbctl rollback webhook-dispatcher --to previous',
    alert: 'mais de 2.000 entregas pendentes por 15 minutos',
    oncallChannel: '#oncall-integracoes',
  },
  {
    id: 'auth-service',
    name: 'auth-service',
    purpose: 'autentica usuários e emite tokens de acesso para a API e o portal',
    team: 'Time Plataforma',
    stack: 'Go 1.23',
    datastore: 'PostgreSQL 16 (banco identity)',
    healthcheck: '/health/auth',
    slo: '99,99% de disponibilidade mensal',
    retry: 'sem novas tentativas; tokens de acesso expiram em 15 minutos',
    rollback: 'orbctl rollback auth-service --to previous --keep-sessions',
    alert: 'taxa de erro 5xx acima de 0,5% em 5 minutos',
    oncallChannel: '#oncall-plataforma',
  },
  {
    id: 'reporting-service',
    name: 'reporting-service',
    purpose: 'gera relatórios financeiros e exportações para os clientes',
    team: 'Time Dados',
    stack: 'Python 3.12 com FastAPI',
    datastore: 'ClickHouse (cluster analytics)',
    healthcheck: '/health/reports',
    slo: '99% dos relatórios entregues em até 30 minutos',
    retry: 'até 2 tentativas por relatório, com intervalo de 5 minutos',
    rollback: 'orbctl rollback reporting-service --to previous',
    alert: 'mais de 50 relatórios na fila por 20 minutos',
    oncallChannel: '#oncall-dados',
  },
  {
    id: 'notification-service',
    name: 'notification-service',
    purpose: 'envia e-mails transacionais, como faturas e avisos de cobrança',
    team: 'Time Integrações',
    stack: 'Node.js 22',
    datastore: 'PostgreSQL 16 (banco notifications) e provedor de e-mail MailRelay',
    healthcheck: '/health/notifications',
    slo: '99,5% dos e-mails aceitos pelo provedor em até 5 minutos',
    retry: 'até 4 tentativas com intervalo fixo de 2 minutos',
    rollback: 'orbctl rollback notification-service --to previous',
    alert: 'taxa de rejeição do provedor acima de 3% em 15 minutos',
    oncallChannel: '#oncall-integracoes',
  },
  {
    id: 'customer-portal',
    name: 'customer-portal',
    purpose: 'é o painel web em que os clientes gerenciam assinaturas, chaves e relatórios',
    team: 'Time Web',
    stack: 'Next.js 15 com React 19',
    datastore: 'sem banco próprio; consome a billing-api e o auth-service',
    healthcheck: '/api/health',
    slo: '99,9% de disponibilidade mensal',
    retry: 'até 2 tentativas no cliente HTTP para chamadas idempotentes',
    rollback: 'orbctl rollback customer-portal --to previous --purge-cdn',
    alert: 'taxa de erro de página acima de 1% em 10 minutos',
    oncallChannel: '#oncall-web',
  },
];

export interface HowTo {
  id: string;
  title: string;
  service: string;
  whenToUse: string;
  steps: string[];
  /** Fato principal, que fica na seção "Limites e observações". */
  limitFact: { key: string; value: string; sentence: string };
  /** Fato secundário, que fica no passo a passo. */
  stepFact: { key: string; value: string };
}

export const HOWTOS: HowTo[] = [
  {
    id: 'rotacionar-chave',
    title: 'Como rotacionar uma chave de API',
    service: 'customer-portal',
    whenToUse: 'Use este procedimento quando uma chave de API vazar, quando um colaborador com acesso sair da empresa cliente ou perto do vencimento da chave.',
    steps: [
      'Acesse o portal e abra Configurações > Chaves de API.',
      'Clique em "Gerar nova chave" e copie o valor exibido, que não será mostrado de novo.',
      'Atualize a chave nos sistemas do cliente.',
      'Revogue a chave antiga no mesmo menu.',
    ],
    stepFact: { key: 'menu', value: 'Configurações > Chaves de API' },
    limitFact: { key: 'validade', value: '90 dias', sentence: 'As chaves de API expiram em 90 dias. Durante a rotação, a chave antiga e a nova funcionam juntas por até 24 horas.' },
  },
  {
    id: 'configurar-webhook',
    title: 'Como configurar e validar webhooks',
    service: 'webhook-dispatcher',
    whenToUse: 'Use quando o cliente precisar receber eventos como invoice.paid ou subscription.canceled no próprio sistema.',
    steps: [
      'Cadastre a URL de destino em Configurações > Webhooks.',
      'Selecione os eventos desejados.',
      'Valide cada entrega conferindo a assinatura HMAC-SHA256 enviada no cabeçalho X-Orbital-Signature.',
      'Responda com status 2xx para confirmar o recebimento.',
    ],
    stepFact: { key: 'cabecalho', value: 'X-Orbital-Signature' },
    limitFact: { key: 'timeout', value: '5 segundos', sentence: 'O sistema do cliente precisa responder em até 5 segundos; acima disso a entrega é considerada falha e entra na política de novas tentativas.' },
  },
  {
    id: 'limites-requisicao',
    title: 'Limites de requisição da API',
    service: 'billing-api',
    whenToUse: 'Consulte quando o cliente receber respostas HTTP 429 (Too Many Requests).',
    steps: [
      'Verifique o cabeçalho Retry-After da resposta 429.',
      'Aguarde o tempo indicado antes de repetir a chamada.',
      'Distribua as chamadas em lote ao longo do minuto.',
      'Se o volume for permanente, solicite aumento de limite ao suporte.',
    ],
    stepFact: { key: 'cabecalho', value: 'Retry-After' },
    limitFact: { key: 'limite', value: '600 requisições por minuto', sentence: 'O limite padrão é de 600 requisições por minuto por chave de API. Clientes Enterprise podem negociar até 3.000 requisições por minuto.' },
  },
  {
    id: 'ambiente-sandbox',
    title: 'Como usar o ambiente sandbox',
    service: 'payments-adapter',
    whenToUse: 'Use para testar integrações de cobrança sem movimentar dinheiro.',
    steps: [
      'Gere uma chave de sandbox no portal.',
      'Aponte as chamadas para https://sandbox.api.orbital.example.',
      'Use os cartões de teste para simular aprovação e recusa.',
      'Confira os eventos de webhook de teste no painel.',
    ],
    stepFact: { key: 'url', value: 'https://sandbox.api.orbital.example' },
    limitFact: { key: 'cartao-recusa', value: '4000 0000 0000 0002', sentence: 'O cartão de teste 4000 0000 0000 0002 sempre simula uma recusa. Os dados do sandbox são apagados a cada 30 dias.' },
  },
  {
    id: 'reprocessar-fatura',
    title: 'Como reprocessar uma fatura com falha',
    service: 'invoice-worker',
    whenToUse: 'Use quando uma fatura ficar com status failed depois de um erro de geração.',
    steps: [
      'Confirme que a fatura está com status failed.',
      'Chame POST /v2/invoices/{id}/reprocess com a chave de API do cliente.',
      'Acompanhe o status até mudar para issued.',
      'Se falhar de novo, abra um chamado com o id da fatura.',
    ],
    stepFact: { key: 'endpoint', value: 'POST /v2/invoices/{id}/reprocess' },
    limitFact: { key: 'maximo', value: '3 reprocessamentos', sentence: 'Cada fatura aceita no máximo 3 reprocessamentos. Depois disso, a correção precisa ser feita pelo Time Faturamento.' },
  },
  {
    id: 'exportar-relatorios',
    title: 'Como exportar relatórios financeiros',
    service: 'reporting-service',
    whenToUse: 'Use para extrair dados de cobranças, inadimplência e receita recorrente.',
    steps: [
      'Abra Relatórios no portal.',
      'Escolha o período e os filtros.',
      'Clique em Exportar CSV.',
      'Para volumes grandes, aguarde o e-mail com o link de download.',
    ],
    stepFact: { key: 'formato', value: 'Exportar CSV' },
    limitFact: { key: 'limite-linhas', value: '100 mil linhas', sentence: 'A exportação direta vai até 100 mil linhas. Acima disso, a exportação é assíncrona e o link enviado por e-mail vale por 72 horas.' },
  },
  {
    id: 'configurar-sso',
    title: 'Como habilitar login único (SSO)',
    service: 'auth-service',
    whenToUse: 'Use quando o cliente quiser que os usuários entrem no portal com o provedor de identidade da própria empresa.',
    steps: [
      'Peça ao cliente o arquivo de metadados SAML do provedor de identidade.',
      'Cadastre o arquivo em Configurações > Segurança > SSO.',
      'Envie ao cliente a URL de ACS https://auth.orbital.example/saml/acs.',
      'Teste o login com um usuário do cliente antes de tornar o SSO obrigatório.',
    ],
    stepFact: { key: 'acs', value: 'https://auth.orbital.example/saml/acs' },
    limitFact: { key: 'plano', value: 'plano Enterprise', sentence: 'O SSO via SAML 2.0 só está disponível no plano Enterprise. Não há suporte a OpenID Connect nesta versão.' },
  },
  {
    id: 'mudar-plano',
    title: 'Como mudar o plano de uma assinatura',
    service: 'billing-api',
    whenToUse: 'Use quando o cliente quiser fazer upgrade ou downgrade de plano.',
    steps: [
      'Chame PATCH /v2/subscriptions/{id} com o novo plan_id.',
      'Para upgrade, a diferença é cobrada na hora.',
      'Para downgrade, a mudança fica agendada.',
      'Confira o evento subscription.updated no webhook.',
    ],
    stepFact: { key: 'endpoint', value: 'PATCH /v2/subscriptions/{id}' },
    limitFact: { key: 'downgrade', value: 'próximo ciclo de cobrança', sentence: 'O upgrade é cobrado pró-rata no mesmo dia; o downgrade só passa a valer no próximo ciclo de cobrança, sem reembolso proporcional.' },
  },
  {
    id: 'atualizar-sdk',
    title: 'Como atualizar o SDK oficial para Node.js',
    service: 'billing-api',
    whenToUse: 'Use quando o cliente ainda usa uma versão antiga do SDK @orbital/billing.',
    steps: [
      'Atualize com npm install @orbital/billing@latest.',
      'Troque chamadas a client.invoices.list por client.invoices.search.',
      'Rode os testes de integração do cliente no sandbox.',
      'Publique a atualização.',
    ],
    stepFact: { key: 'troca', value: 'client.invoices.search' },
    limitFact: { key: 'versao-minima', value: '4.2.0', sentence: 'A versão mínima suportada do SDK é a 4.2.0. A linha 3.x foi descontinuada em 30/06/2026.' },
  },
  {
    id: 'consultar-logs',
    title: 'Como consultar os logs de requisições',
    service: 'customer-portal',
    whenToUse: 'Use para investigar uma chamada específica que o cliente diz ter falhado.',
    steps: [
      'Abra Desenvolvedores > Logs no portal.',
      'Filtre pelo campo request_id informado na resposta da API.',
      'Abra o detalhe para ver corpo da requisição e resposta.',
      'Anexe o request_id ao chamado, se precisar de ajuda.',
    ],
    stepFact: { key: 'filtro', value: 'request_id' },
    limitFact: { key: 'retencao', value: '30 dias', sentence: 'Os logs de requisições ficam disponíveis no portal por 30 dias. Depois disso, só o suporte consegue consultar, por até 1 ano.' },
  },
];

export const CUSTOMERS = [
  'Acme Logística',
  'Banco Horizonte',
  'Clínica Vitalis',
  'Editora Pampa',
  'Farmácias Ipê',
  'Grupo Nébula',
  'Hotel Maré Alta',
  'Instituto Saber',
  'Jota Telecom',
  'Kappa Seguros',
  'Lume Energia',
  'Mercado Serra Azul',
] as const;

export interface Incident {
  id: string;
  date: string; // AAAA-MM-DD
  severity: 'SEV1' | 'SEV2' | 'SEV3';
  service: string;
  title: string;
  symptom: string;
  rootCause: string;
  correctiveAction: string;
  durationMin: number;
  customersAffected: number;
}

const inc = (
  n: number,
  date: string,
  severity: Incident['severity'],
  service: string,
  title: string,
  symptom: string,
  rootCause: string,
  correctiveAction: string,
  durationMin: number,
  customersAffected: number,
): Incident => ({
  id: `INC-2026-${String(n).padStart(3, '0')}`,
  date, severity, service, title, symptom, rootCause, correctiveAction, durationMin, customersAffected,
});

export const INCIDENTS: Incident[] = [
  inc(1, '2026-01-08', 'SEV1', 'payments-adapter', 'Cobranças recusadas em massa', 'cobranças com cartão recusadas com erro técnico', `certificado TLS do gateway ${GATEWAY} expirado no truststore do payments-adapter`, 'monitoramento de validade de certificados com alerta 30 dias antes do vencimento', 94, 312),
  inc(2, '2026-01-21', 'SEV2', 'invoice-worker', 'Atraso na geração de faturas', 'faturas demorando mais de 2 horas para serem geradas', 'migração de banco criou a tabela invoice_items sem índice em invoice_id', 'revisão obrigatória de planos de execução em migrações e criação do índice', 165, 88),
  inc(3, '2026-02-02', 'SEV2', 'webhook-dispatcher', 'Webhooks rejeitados por assinatura inválida', 'clientes rejeitando webhooks por assinatura inválida', 'deploy sem a variável de ambiente WEBHOOK_SIGNING_SECRET, que gerou assinaturas com segredo vazio', 'validação de variáveis obrigatórias no início do processo e bloqueio do deploy', 47, 140),
  inc(4, '2026-02-14', 'SEV3', 'reporting-service', 'Relatórios mensais vazios', 'relatórios de fevereiro exportados sem linhas', 'filtro de fuso horário convertendo datas para UTC e excluindo o primeiro dia do mês', 'testes de fronteira de fuso horário no pipeline de relatórios', 300, 25),
  inc(5, '2026-02-27', 'SEV1', 'billing-api', 'API fora do ar', 'API respondendo 503 para todas as chamadas', 'limite de conexões do PostgreSQL atingido (max_connections = 200) após aumento de réplicas da billing-api', 'adoção de pool de conexões com PgBouncer e limite por réplica', 38, 1040),
  inc(6, '2026-03-11', 'SEV2', 'notification-service', 'E-mails de fatura não entregues', 'e-mails de fatura não chegando aos clientes', 'regra de firewall nova bloqueou a saída para os servidores do provedor MailRelay', 'teste automático de conectividade com o provedor após mudanças de rede', 126, 410),
  inc(7, '2026-03-19', 'SEV1', 'webhook-dispatcher', 'Webhooks de pagamento parados', 'eventos invoice.paid parados por mais de uma hora', 'memória do Redis esgotada porque chaves de entrega foram gravadas sem TTL', 'TTL obrigatório de 48 horas nas chaves de entrega e alerta de memória em 75%', 71, 655),
  inc(8, '2026-03-30', 'SEV3', 'customer-portal', 'Gráficos do painel sem dados', 'gráficos de receita do portal aparecendo vazios', 'cache da CDN servindo uma versão antiga do bundle JavaScript após o deploy', 'invalidação da CDN incluída no procedimento de deploy (--purge-cdn)', 55, 60),
  inc(9, '2026-04-07', 'SEV2', 'auth-service', 'Logins via SSO falhando', 'usuários com SSO sem conseguir entrar no portal', 'relógio de um nó do auth-service adiantado em 6 minutos, invalidando as asserções SAML', 'sincronização de horário via NTP monitorada em todos os nós', 83, 37),
  inc(10, '2026-04-16', 'SEV2', 'invoice-worker', 'Impostos calculados com alíquota errada', 'faturas emitidas com ISS de 5% em municípios com alíquota de 2%', 'feature flag new-tax-engine ativada para todos os clientes em vez de 5% do tráfego', 'exigência de aprovação em dupla para mudar flags de cálculo fiscal', 210, 96),
  inc(11, '2026-04-29', 'SEV3', 'reporting-service', 'Exportações assíncronas sem e-mail', 'links de exportação não enviados por e-mail', 'token de serviço do reporting-service para o notification-service expirado', 'rotação automática de tokens de serviço com 7 dias de antecedência', 240, 19),
  inc(12, '2026-05-06', 'SEV1', 'auth-service', 'Ninguém consegue entrar no portal', 'erro 500 em todas as tentativas de login', 'migração do banco identity travou a tabela sessions por causa de um ALTER TABLE sem LOCK TIMEOUT', 'uso obrigatório de lock_timeout e migrações em duas fases', 29, 1180),
  inc(13, '2026-05-15', 'SEV2', 'payments-adapter', 'Cobranças duplicadas', 'clientes cobrados duas vezes pela mesma fatura', `chave de idempotência descartada quando o ${GATEWAY} respondeu após o timeout de 10 segundos`, 'idempotência mantida por 24 horas e conciliação diária com o gateway', 160, 74),
  inc(14, '2026-05-28', 'SEV3', 'customer-portal', 'Botão de exportar sem resposta', 'botão Exportar CSV sem efeito no Safari', 'uso de API de download não suportada pelo Safari 17', 'testes automatizados de navegador incluindo Safari', 600, 33),
  inc(15, '2026-06-09', 'SEV2', 'billing-api', 'Erros 429 para clientes Enterprise', 'clientes Enterprise recebendo 429 abaixo do limite contratado', 'configuração de limite de requisições aplicada por IP em vez de por chave de API', 'teste de contrato dos limites por plano antes de cada deploy', 95, 12),
  inc(16, '2026-06-18', 'SEV1', 'invoice-worker', 'Fila de faturas parada', 'nenhuma fatura gerada por mais de uma hora', 'atualização do RabbitMQ removeu a fila invoices.generate, que não era declarada como durável', 'declaração das filas como duráveis e verificação pós-atualização', 66, 870),
  inc(17, '2026-06-30', 'SEV3', 'notification-service', 'E-mails com acentos quebrados', 'assunto dos e-mails com caracteres estranhos no lugar de acentos', 'cabeçalho Subject enviado sem codificação MIME UTF-8', 'biblioteca de e-mail atualizada e teste com caracteres acentuados', 180, 205),
  inc(18, '2026-07-08', 'SEV2', 'webhook-dispatcher', 'Webhooks duplicados', 'clientes recebendo o mesmo evento várias vezes', 'novas tentativas disparadas antes do timeout de 5 segundos do cliente terminar', 'espera do timeout completo antes de nova tentativa e id de evento estável para deduplicação', 140, 98),
  inc(19, '2026-07-17', 'SEV2', 'reporting-service', 'Relatórios lentos', 'relatórios demorando mais de 2 horas', 'consulta sem partição por mês varrendo toda a tabela de cobranças no ClickHouse', 'particionamento mensal da tabela de cobranças', 330, 54),
  inc(20, '2026-07-29', 'SEV1', 'payments-adapter', 'Gateway indisponível', 'todas as cobranças falhando por timeout', `indisponibilidade regional do ${GATEWAY}, sem rota alternativa configurada`, 'segunda região do gateway configurada como contingência', 112, 960),
  inc(21, '2026-08-06', 'SEV3', 'auth-service', 'Sessões encerradas no deploy', 'usuários deslogados após cada deploy', 'chave de assinatura de sessão gerada no início de cada processo em vez de lida do cofre', 'chave de sessão persistida no cofre e rollback com --keep-sessions', 20, 300),
  inc(22, '2026-08-19', 'SEV2', 'customer-portal', 'Portal lento', 'páginas do portal levando mais de 10 segundos', 'chamada sem paginação à billing-api trazendo todas as faturas do cliente', 'paginação obrigatória com limite de 100 itens por página', 75, 230),
  inc(23, '2026-09-02', 'SEV1', 'notification-service', 'Avisos de cobrança enviados em duplicidade', 'clientes finais recebendo o mesmo aviso de cobrança dezenas de vezes', 'laço de novas tentativas sem limite após mudança na biblioteca de fila', 'limite de 4 tentativas aplicado na camada de envio e alerta por volume anômalo', 44, 520),
  inc(24, '2026-09-15', 'SEV3', 'billing-api', 'Documentação da API desatualizada', 'exemplos da documentação retornando 404', 'rotas v1 removidas antes da data anunciada de descontinuação', 'checagem automática de rotas descontinuadas contra o calendário publicado', 400, 15),
  inc(25, '2026-09-24', 'SEV2', 'invoice-worker', 'PDFs de fatura em branco', 'faturas em PDF geradas sem conteúdo', 'fonte tipográfica ausente na nova imagem de contêiner do invoice-worker', 'teste de renderização de PDF no pipeline de imagens', 90, 143),
];

export interface Policy {
  id: string;
  title: string;
  owner: string;
  sections: { heading: string; text: string; fact?: { key: string; value: string } }[];
}

export const POLICIES: Policy[] = [
  {
    id: 'POL-01', title: 'Política de severidade e resposta a incidentes', owner: 'Engenharia de Confiabilidade',
    sections: [
      { heading: 'Classificação', text: 'SEV1 é a indisponibilidade total ou perda financeira para muitos clientes; SEV2 é a degradação relevante com contorno; SEV3 é o impacto limitado.' },
      { heading: 'Prazos de resposta', text: 'Para SEV1, a primeira resposta do plantão deve ocorrer em até 15 minutos e há comunicação aos clientes a cada 30 minutos. Para SEV2, a primeira resposta é em até 1 hora. Para SEV3, em até 1 dia útil.', fact: { key: 'resposta-sev1', value: '15 minutos' } },
      { heading: 'Postmortem', text: 'Todo incidente SEV1 ou SEV2 exige postmortem sem culpados publicado em até 5 dias úteis.', fact: { key: 'prazo-postmortem', value: '5 dias úteis' } },
    ],
  },
  {
    id: 'POL-02', title: 'Política de senhas e autenticação', owner: 'Segurança da Informação',
    sections: [
      { heading: 'Requisitos de senha', text: 'Senhas de colaboradores têm no mínimo 14 caracteres e não podem repetir as últimas 10 senhas.', fact: { key: 'tamanho-minimo', value: '14 caracteres' } },
      { heading: 'Segundo fator', text: 'O segundo fator de autenticação é obrigatório para todos os colaboradores, com chave física para quem tem acesso à produção.', fact: { key: 'mfa-producao', value: 'chave física' } },
    ],
  },
  {
    id: 'POL-03', title: 'Política de retenção de dados', owner: 'Jurídico e Privacidade',
    sections: [
      { heading: 'Dados de cobrança', text: 'Dados de faturas e cobranças são mantidos por 5 anos, para cumprir obrigações fiscais.', fact: { key: 'faturas', value: '5 anos' } },
      { heading: 'Dados de log', text: 'Logs de aplicação são mantidos por 1 ano e depois apagados de forma automática.', fact: { key: 'logs', value: '1 ano' } },
    ],
  },
  {
    id: 'POL-04', title: 'Política de atendimento a titulares (LGPD)', owner: 'Jurídico e Privacidade',
    sections: [
      { heading: 'Prazo', text: 'Pedidos de acesso ou exclusão de dados pessoais devem ser respondidos em até 15 dias corridos.', fact: { key: 'prazo-titular', value: '15 dias corridos' } },
      { heading: 'Canal', text: 'Os pedidos chegam pelo e-mail privacidade@orbital.example e são registrados no sistema de chamados com a etiqueta lgpd.', fact: { key: 'canal', value: 'privacidade@orbital.example' } },
    ],
  },
  {
    id: 'POL-05', title: 'Política de plantão', owner: 'Engenharia de Confiabilidade',
    sections: [
      { heading: 'Escala', text: 'O plantão é semanal, com troca às segundas-feiras às 10h, e cada pessoa fica no máximo uma semana a cada quatro.', fact: { key: 'troca', value: 'segundas-feiras às 10h' } },
      { heading: 'Compensação', text: 'Cada semana de plantão dá direito a um dia de folga compensatória, a ser usado em até 60 dias.', fact: { key: 'folga', value: 'um dia de folga compensatória' } },
    ],
  },
  {
    id: 'POL-06', title: 'Política de revisão de acessos', owner: 'Segurança da Informação',
    sections: [
      { heading: 'Periodicidade', text: 'Os acessos à produção são revisados a cada trimestre pelos líderes de cada time.', fact: { key: 'periodicidade', value: 'a cada trimestre' } },
      { heading: 'Desligamentos', text: 'Os acessos de quem sai da empresa são revogados em até 4 horas após a comunicação do RH.', fact: { key: 'revogacao', value: '4 horas' } },
    ],
  },
  {
    id: 'POL-07', title: 'Política de mudanças em produção', owner: 'Engenharia de Plataforma',
    sections: [
      { heading: 'Janela de congelamento', text: 'Não há deploys em produção entre 20 de dezembro e 5 de janeiro, salvo correções de SEV1.', fact: { key: 'congelamento', value: 'entre 20 de dezembro e 5 de janeiro' } },
      { heading: 'Aprovação', text: 'Mudanças em serviços de pagamento exigem aprovação de duas pessoas, sendo uma do Time Pagamentos.', fact: { key: 'aprovacao-pagamentos', value: 'aprovação de duas pessoas' } },
    ],
  },
  {
    id: 'POL-08', title: 'Política de créditos por indisponibilidade', owner: 'Sucesso do Cliente',
    sections: [
      { heading: 'Elegibilidade', text: 'Clientes afetados por incidentes SEV1 com mais de 60 minutos de duração recebem crédito automático.', fact: { key: 'elegibilidade', value: 'mais de 60 minutos' } },
      { heading: 'Valor', text: 'O crédito é de 10% da mensalidade, limitado a 30% por mês.', fact: { key: 'valor', value: '10% da mensalidade' } },
    ],
  },
  {
    id: 'POL-09', title: 'Política de classificação da informação', owner: 'Segurança da Informação',
    sections: [
      { heading: 'Níveis', text: 'As informações são classificadas como pública, interna, confidencial ou restrita. Dados de cartão são sempre restritos.', fact: { key: 'cartao', value: 'restritos' } },
      { heading: 'Compartilhamento', text: 'Informação confidencial só pode ser enviada a terceiros com acordo de confidencialidade assinado.' },
    ],
  },
  {
    id: 'POL-10', title: 'Política de uso de dados de clientes em testes', owner: 'Jurídico e Privacidade',
    sections: [
      { heading: 'Regra geral', text: 'É proibido usar dados reais de clientes em ambientes de teste; use o sandbox ou dados sintéticos.', fact: { key: 'regra', value: 'proibido usar dados reais de clientes' } },
      { heading: 'Exceções', text: 'Exceções exigem anonimização aprovada pelo encarregado de dados (DPO) e valem por no máximo 30 dias.', fact: { key: 'excecao', value: 'encarregado de dados (DPO)' } },
    ],
  },
  {
    id: 'POL-11', title: 'Política de backup e recuperação', owner: 'Engenharia de Plataforma',
    sections: [
      { heading: 'Frequência', text: 'Bancos de produção têm backup completo diário e backup contínuo de logs de transação, com retenção de 35 dias.', fact: { key: 'retencao-backup', value: '35 dias' } },
      { heading: 'Testes de restauração', text: 'A restauração de cada banco é testada uma vez por mês, com meta de recuperação (RTO) de 4 horas.', fact: { key: 'rto', value: '4 horas' } },
    ],
  },
  {
    id: 'POL-12', title: 'Política de comunicação com clientes em incidentes', owner: 'Sucesso do Cliente',
    sections: [
      { heading: 'Canal oficial', text: 'A comunicação oficial é feita pela página status.orbital.example; e-mails individuais só para clientes Enterprise.', fact: { key: 'canal', value: 'status.orbital.example' } },
      { heading: 'Aprovação', text: 'Mensagens públicas sobre incidentes SEV1 são aprovadas pelo líder do incidente e por Sucesso do Cliente.' },
    ],
  },
  {
    id: 'POL-13', title: 'Política de descontinuação de versões da API', owner: 'Produto',
    sections: [
      { heading: 'Aviso prévio', text: 'Versões da API são descontinuadas com aviso prévio mínimo de 12 meses.', fact: { key: 'aviso', value: '12 meses' } },
      { heading: 'Versão v1', text: 'A versão v1 da API será desligada em 31/12/2026.', fact: { key: 'v1', value: '31/12/2026' } },
    ],
  },
  {
    id: 'POL-14', title: 'Política de acesso de fornecedores', owner: 'Segurança da Informação',
    sections: [
      { heading: 'Acesso temporário', text: 'Fornecedores recebem acesso temporário de até 30 dias, renovável mediante justificativa.', fact: { key: 'duracao', value: '30 dias' } },
      { heading: 'Registro', text: 'Toda sessão de fornecedor em produção é gravada e revisada por amostragem.' },
    ],
  },
  {
    id: 'POL-15', title: 'Política de suporte e prazos de atendimento', owner: 'Sucesso do Cliente',
    sections: [
      { heading: 'Prazos por prioridade', text: 'Chamados de prioridade urgente têm primeira resposta em até 1 hora; alta, em até 4 horas; normal, em até 1 dia útil.', fact: { key: 'urgente', value: '1 hora' } },
      { heading: 'Horário', text: 'O suporte padrão funciona de segunda a sexta, das 8h às 20h; clientes Enterprise têm suporte 24x7.', fact: { key: 'enterprise', value: '24x7' } },
    ],
  },
];
