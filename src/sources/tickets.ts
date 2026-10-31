import type { EvidenceUnit } from '../core/types.js';
import { brDate } from '../corpus/model.js';

/** Chamado de suporte, como gravado em `tickets/tickets.json`. */
export interface TicketRecord {
  id: string;
  criado_em: string;
  cliente: string;
  prioridade: 'normal' | 'alta' | 'urgente';
  status: 'resolvido' | 'fechado';
  servico: string;
  assunto: string;
  descricao: string;
  comentarios: { autor: string; data: string; texto: string }[];
  resolucao: string;
}

export function ticketUnits(t: TicketRecord): EvidenceUnit[] {
  const title = `Chamado ${t.id}: ${t.assunto}`;
  const comments = t.comentarios.map((c) => `- ${c.autor} (${brDate(c.data)}): ${c.texto}`).join('\n');
  const description = [
    `Cliente: ${t.cliente}`,
    `Aberto em: ${brDate(t.criado_em)}`,
    `Serviço: ${t.servico}`,
    `Prioridade: ${t.prioridade}`,
    `Assunto: ${t.assunto}`,
    '',
    t.descricao,
    ...(comments ? ['', 'Comentários:', comments] : []),
  ].join('\n');
  return [
    { id: `${t.id}#descricao`, docId: t.id, source: 'tickets', title, heading: 'Descrição', text: description },
    { id: `${t.id}#resolucao`, docId: t.id, source: 'tickets', title, heading: 'Resolução', text: t.resolucao },
  ];
}

export function parseTickets(json: string): EvidenceUnit[] {
  return (JSON.parse(json) as TicketRecord[]).flatMap(ticketUnits);
}
