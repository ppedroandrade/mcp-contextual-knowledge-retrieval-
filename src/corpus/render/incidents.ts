import { toCsv } from '../../sources/csv.js';
import { INCIDENT_COLUMNS, type TimelineFile } from '../../sources/incidents.js';
import { FactSink, type SourceOutput } from '../model.js';
import type { Rng } from '../random.js';
import { INCIDENTS, SERVICES } from '../world.js';

const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Registros de incidentes em CSV, com a linha do tempo em JSON separado. */
export function renderIncidents(rng: Rng): SourceOutput {
  const sink = new FactSink('incidents');
  const rows: string[][] = [[...INCIDENT_COLUMNS]];
  const timeline: TimelineFile = {};

  for (const i of INCIDENTS) {
    const f = (k: string) => `inc.${i.id}.${k}`;
    rows.push([i.id, i.date, i.severity, i.service, i.title, String(i.durationMin), String(i.customersAffected), i.symptom, i.rootCause, i.correctiveAction]);
    sink.add(f('servico'), `Serviço afetado: ${i.service}`, i.id, 'resumo');
    sink.add(f('severidade'), `Severidade: ${i.severity}`, i.id, 'resumo');
    sink.add(f('duracao'), `${i.durationMin} minutos`, i.id, 'resumo');
    sink.add(f('clientes'), `Clientes afetados: ${i.customersAffected}`, i.id, 'resumo');
    sink.add(f('causa'), i.rootCause, i.id, 'causa-raiz');
    sink.add(f('acao'), i.correctiveAction, i.id, 'acoes');

    const team = SERVICES.find((s) => s.id === i.service)!.team;
    const start = rng.int(0, 23 * 60);
    const detect = start + rng.int(2, 15);
    const mitigate = start + Math.max(detect - start + 5, Math.round(i.durationMin * 0.7));
    timeline[i.id] = [
      { hora: hhmm(start), evento: `Início do impacto: ${i.symptom}.` },
      { hora: hhmm(detect), evento: `Alerta recebido; plantão do ${team} assumiu o incidente.` },
      { hora: hhmm(mitigate), evento: 'Mitigação aplicada; métricas voltando ao normal.' },
      { hora: hhmm(start + i.durationMin), evento: 'Incidente encerrado.' },
    ];
  }

  return {
    files: [
      { path: 'incidents/incidents.csv', content: toCsv(rows) },
      { path: 'incidents/timeline.json', content: JSON.stringify(timeline, null, 2) + '\n' },
    ],
    facts: sink.facts,
  };
}
