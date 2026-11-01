import type { SourceName } from '../core/types.js';

/**
 * Descrição de cada fonte integrada ao sistema, usada nas tools do servidor MCP, no prompt e
 * na documentação. `policies` existe no corpus (com as perguntas), mas ainda não está
 * integrada: entra depois do congelamento, na medida da H3 (ADR 009).
 */
export const SOURCE_CATALOG: Partial<Record<SourceName, { title: string; description: string }>> = {
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

/** Descrição de uma fonte integrada; falha para uma fonte que o sistema ainda não conhece. */
export function sourceInfo(source: SourceName): { title: string; description: string } {
  const info = SOURCE_CATALOG[source];
  if (!info) throw new Error(`fonte não integrada: ${source}`);
  return info;
}

export const toolName = (source: SourceName) => `buscar_${source}`;
