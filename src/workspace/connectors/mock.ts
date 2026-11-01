import { DRIVE_API, GOOGLE_TOKEN_URL } from './google-drive.js';

/**
 * APIs simuladas do Google (OAuth + Drive) e do Confluence Cloud, com o conteúdo de uma empresa
 * fictícia (Aurora Logística). Servem para os testes e para `npm run workspace -- --conectores
 * simulados`, sem conta real. **Dados sintéticos.** As respostas seguem o formato das APIs
 * reais nos campos que os conectores leem.
 */

export const MOCK_CONFLUENCE_URL = 'https://aurora-logistica.atlassian.net';

interface MockDriveFile { id: string; name: string; mimeType: string; modifiedTime: string; html?: string; text?: string }
interface MockPage { id: string; spaceId: string; title: string; version: number; html: string }

const doc = (title: string, ...sections: [string, string][]) =>
  `<html><head><title>${title}</title></head><body>${sections.map(([h, p]) => `<h2>${h}</h2>${p.split('\n').map((x) => `<p>${x}</p>`).join('')}`).join('')}</body></html>`;

export function mockDriveFiles(): MockDriveFile[] {
  return [
    { id: '1aR3embolsoXyZ', name: 'Política de reembolso de despesas', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-10-20T14:02:00.000Z',
      html: doc('Política de reembolso de despesas',
        ['Quem pode pedir', 'Todo colaborador CLT ou PJ com contrato ativo pode pedir reembolso de despesas feitas a trabalho.'],
        ['Prazo', 'O pedido deve ser feito em até 30 dias corridos depois da despesa, pelo portal Despesas, com a nota fiscal anexada.\nPedidos fora do prazo só com aprovação do diretor da área.'],
        ['Limites', 'Refeição em viagem: até R$ 95 por dia. Hospedagem: até R$ 420 por noite nas capitais e R$ 300 no interior. Quilometragem com carro próprio: R$ 1,10 por km.'],
        ['Pagamento', 'O reembolso aprovado é pago na folha seguinte, ou em até 10 dias úteis para PJ.']) },
    { id: '1bOnboardingAbC', name: 'Onboarding de novos colaboradores', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-09-02T10:15:00.000Z',
      html: doc('Onboarding de novos colaboradores',
        ['Primeiro dia', 'O gestor recebe o novo colaborador às 9h e apresenta o time. O notebook é entregue pela equipe de TI no mesmo dia.'],
        ['Acessos', 'O acesso ao e-mail, ao Slack e ao VPN é criado pelo time de TI até 24 horas antes do primeiro dia. O acesso à produção só depois do treinamento de segurança.'],
        ['Primeira semana', 'Treinamento de segurança da informação (obrigatório), apresentação dos produtos e uma conversa de 30 minutos com o RH.']) },
    { id: '1cFeriasDeF', name: 'Férias e folgas 2026', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-01-10T09:00:00.000Z',
      html: doc('Férias e folgas 2026',
        ['Como pedir', 'As férias são pedidas no portal do RH com pelo menos 45 dias de antecedência e aprovadas pelo gestor.'],
        ['Recesso de fim de ano', 'A empresa fecha de 24/12/2026 a 01/01/2027. Os dias do recesso não são descontados das férias.']) },
    { id: '1dCanaisTxt', name: 'Canais de atendimento.txt', mimeType: 'text/plain', modifiedTime: '2026-08-11T16:40:00.000Z',
      text: 'Canais de atendimento ao cliente\n\nTelefone 0800 777 2026, de segunda a sábado, das 7h às 22h.\n\nChat no app Aurora, 24 horas.\n\nClientes corporativos com contrato Ouro têm gerente de conta dedicado e SLA de primeira resposta de 1 hora.' },
  ];
}

export function mockConfluencePages(): MockPage[] {
  return [
    { id: '65537', spaceId: '1001', title: 'Runbook: API de rastreamento', version: 7,
      html: '<h2>Saúde</h2><p>O endpoint de saúde é <code>GET /health</code> na porta 8080. Se responder 503 por mais de 2 minutos, acione o plantão de plataforma.</p><h2>Rollback</h2><p>Use <code>deploy rollback rastreamento --para anterior</code>. O rollback leva cerca de 4 minutos.</p><ac:structured-macro ac:name="info"><ac:rich-text-body><p>Nunca faça rollback durante a janela de faturamento (dia 1, das 0h às 6h).</p></ac:rich-text-body></ac:structured-macro>' },
    { id: '65538', spaceId: '1001', title: 'Processo de deploy', version: 3,
      html: '<h2>Janelas</h2><p>Deploys em produção de terça a quinta, das 10h às 16h. Sexta-feira só correções urgentes, com aprovação do líder técnico.</p><h2>Checklist</h2><ul><li>Pipeline verde</li><li>Feature flag criada</li><li>Plano de rollback descrito no PR</li></ul>' },
    { id: '65539', spaceId: '1002', title: 'Postmortem: atraso nas entregas de 14/10/2026', version: 2,
      html: '<h2>Resumo</h2><p>Em 14/10/2026, das 8h10 às 11h40, o roteirizador ficou fora do ar e 3.200 entregas atrasaram.</p><h2>Causa raiz</h2><p>O certificado TLS do serviço de mapas expirou. O alerta de expiração estava configurado só para o ambiente de homologação.</p><h2>Ações</h2><p>Alerta de expiração de certificado em produção com 30 dias de antecedência (responsável: time de plataforma).</p>' },
    { id: '65540', spaceId: '1002', title: 'Escala de plantão', version: 11,
      html: '<h2>Plantão de plataforma</h2><p>Rodízio semanal, troca às segundas às 10h. O plantonista tem 15 minutos para reconhecer um alerta crítico no PagerDuty.</p>' },
  ];
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export interface MockApis {
  fetch: typeof fetch;
  drive: MockDriveFile[];
  pages: MockPage[];
  /** Chamadas recebidas (método e URL), para os testes. */
  calls: string[];
}

/** `fetch` que responde como as APIs do Google e do Confluence. Credenciais aceitas: `demo@aurora.com.br` + `token-demo`. */
export function createMockApis(): MockApis {
  const drive = mockDriveFiles();
  const pages = mockConfluencePages();
  const spaces = [{ id: '1001', key: 'ENG', name: 'Engenharia' }, { id: '1002', key: 'OPS', name: 'Operações' }];
  const calls: string[] = [];
  const validBasic = `Basic ${Buffer.from('demo@aurora.com.br:token-demo').toString('base64')}`;

  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${url.origin}${url.pathname}${url.search}`);
    const headers = new Headers(init?.headers);

    if (url.href.startsWith(GOOGLE_TOKEN_URL)) {
      const body = new URLSearchParams(String(init?.body ?? ''));
      if (body.get('grant_type') === 'authorization_code' && body.get('code') === 'codigo-simulado') {
        return json({ access_token: 'ya29.simulado', expires_in: 3599, refresh_token: '1//refresh-simulado', token_type: 'Bearer' });
      }
      if (body.get('grant_type') === 'refresh_token' && body.get('refresh_token') === '1//refresh-simulado') return json({ access_token: 'ya29.simulado', expires_in: 3599 });
      return json({ error: 'invalid_grant' }, 400);
    }

    if (url.href.startsWith(DRIVE_API)) {
      if (headers.get('authorization') !== 'Bearer ya29.simulado') return json({ error: { code: 401, message: 'Invalid Credentials' } }, 401);
      const m = /\/files\/([^/]+)(\/export)?$/.exec(url.pathname);
      if (url.pathname.endsWith('/files')) {
        return json({ files: drive.map(({ id, name, mimeType, modifiedTime }) => ({ id, name, mimeType, modifiedTime, webViewLink: `https://docs.google.com/document/d/${id}/edit` })) });
      }
      const f = m && drive.find((x) => x.id === decodeURIComponent(m[1]!));
      if (!f) return json({ error: { code: 404, message: 'File not found' } }, 404);
      if (m[2]) return new Response(f.html ?? '', { headers: { 'content-type': 'text/html' } });
      return new Response(f.text ?? '', { headers: { 'content-type': f.mimeType } });
    }

    if (url.origin === MOCK_CONFLUENCE_URL) {
      if (headers.get('authorization') !== validBasic) return json({ code: 401, message: 'Unauthorized; scope does not match' }, 401);
      if (url.pathname === '/wiki/api/v2/spaces') {
        const keys = url.searchParams.get('keys')?.split(',');
        return json({ results: keys ? spaces.filter((s) => keys.includes(s.key)) : spaces, _links: {} });
      }
      if (url.pathname === '/wiki/api/v2/pages') {
        const ids = url.searchParams.get('space-id')?.split(',');
        const list = pages.filter((p) => !ids || ids.includes(p.spaceId));
        // Duas páginas por resposta, para exercitar a paginação por cursor.
        const start = Number(url.searchParams.get('cursor') ?? 0);
        const slice = list.slice(start, start + 2);
        const next = start + 2 < list.length ? `/wiki/api/v2/pages?cursor=${start + 2}${ids ? `&space-id=${ids.join(',')}` : ''}&body-format=storage` : undefined;
        return json({
          results: slice.map((p) => ({ id: p.id, title: p.title, spaceId: p.spaceId, status: 'current', version: { number: p.version, createdAt: '2026-10-30T12:00:00.000Z' }, body: { storage: { value: p.html, representation: 'storage' } }, _links: { webui: `/spaces/${spaces.find((s) => s.id === p.spaceId)!.key}/pages/${p.id}` } })),
          _links: next ? { next } : {},
        });
      }
      return json({ message: 'not found' }, 404);
    }
    return json({ error: `URL fora das APIs simuladas: ${url.href}` }, 502);
  }) as typeof fetch;

  return { fetch: fetchFn, drive, pages, calls };
}
