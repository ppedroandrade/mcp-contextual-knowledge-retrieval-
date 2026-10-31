import type { SourceName } from '../core/types.js';

/** Descrição de cada fonte, usada nas tools do servidor MCP e na documentação. */
export const SOURCE_CATALOG: Record<SourceName, { title: string; description: string }> = {
  docs: {
    title: 'Wiki técnica',
    description: 'Documentação técnica interna: arquitetura e runbook de cada serviço (saúde, rollback, plantão, SLO) e guias práticos da plataforma.',
  },
  tickets: {
    title: 'Chamados de suporte',
    description: 'Chamados abertos por clientes, com descrição, comentários e resolução. Útil para saber o que aconteceu com um cliente específico.',
  },
  incidents: {
    title: 'Registros de incidentes',
    description: 'Postmortems de incidentes de produção: data, severidade, serviço afetado, sintoma, causa raiz, ação corretiva e linha do tempo.',
  },
  policies: {
    title: 'Políticas internas',
    description: 'Políticas da empresa: severidade e resposta a incidentes, segurança, privacidade (LGPD), plantão, créditos a clientes e suporte.',
  },
};

export const toolName = (source: SourceName) => `buscar_${source}`;
