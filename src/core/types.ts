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

/**
 * Unidade de evidência: menor trecho que sustenta uma resposta (seção de um documento,
 * campo de um chamado, etc.). Id no formato `<docId>#<slug>`.
 */
export interface EvidenceUnit {
  id: string;
  docId: string;
  source: SourceName;
  /** Título do documento de origem. */
  title: string;
  heading: string;
  text: string;
}

/** Item devolvido por uma abordagem de recuperação. */
export interface Hit {
  chunkId: string;
  unitId: string;
  docId: string;
  source: SourceName;
  text: string;
  score: number;
}

export type QuestionType = 'single-source' | 'multi-source' | 'unanswerable';
export type QuestionSet = 'dev' | 'heldout' | 'policies';

/** Pergunta de avaliação com gabarito derivado dos fatos do corpus. */
export interface Question {
  id: string;
  text: string;
  type: QuestionType;
  set: QuestionSet;
  /** Fontes que contêm evidência (vazio se não houver resposta no corpus). */
  sources: SourceName[];
  /** Documentos que contêm a resposta (ground truth da recuperação). */
  relevantDocIds: string[];
  /**
   * Evidências necessárias, no nível da unidade. Cada item externo é uma evidência
   * necessária; cada item interno é uma alternativa que a satisfaz.
   */
  evidence: string[][];
  /** Fatos do mundo em que a resposta se baseia (rastreabilidade). */
  factIds: string[];
  /** Resposta de referência gerada a partir dos fatos. */
  referenceAnswer: string;
}

/** Contrato único das abordagens comparadas. */
export interface Retriever {
  readonly name: string;
  search(query: string, k: number): Promise<Hit[]>;
  close?(): Promise<void>;
}
