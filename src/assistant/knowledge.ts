import type { Embedder } from '../indexing/embeddings.js';
import type { Connector, IncomingDocument } from './connectors.js';
import { chunkDocument, parseFile } from './documents.js';
import type { ChunkHit, ChunkStore } from './store.js';
import type { DocumentMeta, Workspace } from './workspace.js';

/** Texto do embedding: título do documento, seção e trecho (o mesmo arranjo do `indexText` do TCC). */
export const embeddingText = (docTitle: string, heading: string, text: string) => `${docTitle}\n${heading}\n${text}`;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Lê, divide em trechos, calcula os embeddings e grava um documento numa fonte. */
export async function indexDocument(ws: Workspace, store: ChunkStore, embedder: Embedder, sourceId: string, doc: IncomingDocument): Promise<DocumentMeta> {
  const parsed = await parseFile(doc.fileName, doc.data);
  const title = doc.title || parsed.title;
  const chunks = chunkDocument(parsed);
  if (chunks.length === 0) throw new Error(`${doc.fileName}: nenhum texto encontrado (PDF escaneado sem OCR?)`);
  const vectors = await embedder.embed(chunks.map((c) => embeddingText(title, c.heading, c.text)));
  await store.replaceDocument(sourceId, doc.id, chunks.map((c, i) => ({
    chunk: { id: `${sourceId}:${doc.id}:${i}`, sourceId, docId: doc.id, docTitle: title, url: doc.url, heading: c.heading, text: c.text },
    embedding: vectors[i]!,
  })));
  ws.upsertDocument(sourceId, { id: doc.id, title, url: doc.url, chunks: chunks.length, updatedAt: doc.updatedAt });
  return ws.getSource(sourceId).documents.find((d) => d.id === doc.id)!;
}

/** Retira um documento do índice e da fonte. */
export async function removeDocument(ws: Workspace, store: ChunkStore, sourceId: string, docId: string) {
  await store.deleteDocument(sourceId, docId);
  ws.removeDocument(sourceId, docId);
}

/**
 * Sincroniza uma fonte com o conector: indexa o que é novo ou mudou (pela data de
 * atualização), retira o que sumiu na origem e registra os documentos que não puderam ser
 * lidos sem parar a sincronização.
 */
export async function syncSource(ws: Workspace, store: ChunkStore, embedder: Embedder, sourceId: string, connector: Connector): Promise<void> {
  ws.updateSource(sourceId, { status: 'sincronizando', error: null });
  try {
    const seen = new Set<string>();
    const failures: string[] = [];
    for await (const doc of connector.fetchDocuments(ws.getSource(sourceId), ws.getSecret(sourceId))) {
      seen.add(doc.id);
      const known = ws.getSource(sourceId).documents.find((d) => d.id === doc.id);
      if (known && doc.updatedAt && known.updatedAt === doc.updatedAt) continue;
      try {
        await indexDocument(ws, store, embedder, sourceId, doc);
      } catch (err) {
        failures.push(`${doc.title}: ${message(err)}`);
      }
    }
    for (const d of ws.getSource(sourceId).documents) if (!seen.has(d.id)) await removeDocument(ws, store, sourceId, d.id);
    ws.updateSource(sourceId, {
      status: 'pronta',
      error: failures.length ? `${failures.length} documento(s) não lido(s): ${failures.slice(0, 3).join('; ')}` : null,
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    ws.updateSource(sourceId, { status: 'erro', error: message(err) });
  }
}

/** Busca vetorial numa fonte: é o que cada tool do servidor MCP executa. */
export async function searchSource(store: ChunkStore, embedder: Embedder, sourceId: string, query: string, k: number): Promise<ChunkHit[]> {
  const [v] = await embedder.embed([query]);
  return store.search(v!, k, sourceId);
}
