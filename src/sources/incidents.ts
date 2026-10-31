import type { EvidenceUnit } from '../core/types.js';
import { brDate } from '../corpus/model.js';
import { csvRecords } from './csv.js';

export const INCIDENT_COLUMNS = [
  'id', 'data', 'severidade', 'servico', 'titulo', 'duracao_min', 'clientes_afetados', 'sintoma', 'causa_raiz', 'acao_corretiva',
] as const;

export type TimelineFile = Record<string, { hora: string; evento: string }[]>;

/** Registros de incidentes: `incidents.csv` (uma linha por incidente) + `timeline.json`. */
export function parseIncidents(csv: string, timelineJson: string): EvidenceUnit[] {
  const timeline = JSON.parse(timelineJson) as TimelineFile;
  return csvRecords(csv).flatMap((r) => {
    const id = r.id!;
    const title = `${id}: ${r.titulo}`;
    const u = (slug: string, heading: string, text: string): EvidenceUnit =>
      ({ id: `${id}#${slug}`, docId: id, source: 'incidents', title, heading, text });
    const events = (timeline[id] ?? []).map((e) => `${e.hora} - ${e.evento}`).join('\n');
    return [
      u('resumo', 'Resumo', [
        `${r.titulo}.`,
        `Data: ${brDate(r.data!)}. Severidade: ${r.severidade}. Serviço afetado: ${r.servico}.`,
        `Sintoma: ${r.sintoma}.`,
        `Duração: ${r.duracao_min} minutos. Clientes afetados: ${r.clientes_afetados}.`,
      ].join('\n')),
      u('causa-raiz', 'Causa raiz', r.causa_raiz!),
      u('acoes', 'Ação corretiva', r.acao_corretiva!),
      u('linha-do-tempo', 'Linha do tempo', events),
    ];
  });
}
