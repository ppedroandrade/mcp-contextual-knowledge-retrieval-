/** Tipos compartilhados por todas as abordagens. Ver docs/arquitetura.md. */

/** Fontes corporativas sintéticas. A lista final é fechada junto com o corpus. */
export type SourceName = 'docs' | 'tickets' | 'incidents' | 'policies';

/** Documento como existe na fonte de origem, antes da segmentação. */
export interface SourceDocument {
  id: string;
  source: SourceName;
  title: string;
  body: string;
  /** Metadados próprios da fonte (ex.: prioridade do chamado, data do incidente). */
  metadata?: Record<string, string | number | boolean>;
}

/** Trecho indexável de um documento. */
export interface Chunk {
  id: string;
  docId: string;
  source: SourceName;
  text: string;
  position: number;
}

/** Item devolvido por uma abordagem de recuperação. */
export interface Hit {
  chunkId: string;
  docId: string;
  source: SourceName;
  text: string;
  score: number;
}

/** Pergunta de avaliação com gabarito. */
export interface Question {
  id: string;
  text: string;
  /** Documentos que contêm a resposta (ground truth da recuperação). */
  relevantDocIds: string[];
  /** Resposta de referência escrita junto com o corpus. */
  referenceAnswer: string;
  /** Pergunta que exige evidências de mais de uma fonte. */
  multiSource: boolean;
}

/** Contrato único das abordagens comparadas. */
export interface Retriever {
  readonly name: string;
  search(query: string, k: number): Promise<Hit[]>;
  close?(): Promise<void>;
}
