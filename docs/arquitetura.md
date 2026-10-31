# Arquitetura — proposta inicial (para discussão)

Status: **planejado**. Nada aqui foi implementado ainda.

## 1. Princípio

Todas as abordagens implementam a mesma interface e recebem as mesmas entradas.
Tudo o que vem depois da recuperação (geração, avaliação, benchmark) é **um único
código** compartilhado. Isso é o que torna a comparação controlada.

```ts
interface Retriever {
  name: string;
  search(query: string, k: number): Promise<Hit[]>; // Hit = trecho + fonte + score
}
```

## 2. Fluxo

```mermaid
flowchart LR
  G[corpus: gerador com semente] --> D[(data/corpus)]
  Q[(data/questions)]
  D --> S[sources: leitura + segmentação]
  S --> IX[indexing: BM25 e vetorial]
  IX --> A1[1. Busca textual]
  IX --> A2[2. RAG tradicional]
  IX --> MS[mcp/server: uma tool por fonte]
  MS -- MCP --> A3[3. MCP + RAG: host descobre e chama as tools]
  A1 & A2 & A3 --> H[Hit[]]
  H --> EV[evaluation: métricas de recuperação]
  H --> GEN[generation: LLM, mesmo prompt]
  GEN --> EVA[evaluation: qualidade das respostas]
  Q --> EV & EVA
  EV & EVA --> R[(results/runs/id)]
```

## 3. Decisões em aberto

| # | Decisão | Opções | Sugestão inicial |
| --- | --- | --- | --- |
| 1 | Banco vetorial | pgvector (Postgres) · Qdrant · em memória | pgvector via Docker: SQL conhecido, um serviço só |
| 2 | Embeddings | modelo local via transformers.js · Ollama · API paga · LSA próprio | modelo local gratuito e fixado por versão |
| 3 | LLM para respostas | Ollama local · API paga (precisa aprovação) | Ollama local, modelo e versão fixados |
| 4 | Transporte MCP | stdio · Streamable HTTP | stdio no experimento; HTTP opcional para a demo |
| 5 | Fontes sintéticas | quantas e quais | ≥ 3 heterogêneas: documentação, chamados, incidentes (+ políticas) |
| 6 | Controle "protocolo × estratégia" | incluir ou não uma config. de busca por fonte **sem** MCP | incluir: sem ela não dá para dizer se o ganho vem do MCP ou da estratégia |
| 7 | Métricas e testes | conforme TCC 1 | confirmar no TCC 1; dados pareados por pergunta pedem teste pareado (ex.: Wilcoxon) |

A decisão 6 vem da revisão do protótipo anterior: lá, o ganho atribuído ao MCP vinha
da busca por fonte com fusão, e não do protocolo. Vale prever isso desde o início.

## 4. Demonstração (opcional, depois do benchmark)

Uma UI de demonstração, no estilo de um caderno de perguntas sobre as fontes (fontes à
esquerda, chat no centro, trechos citados com a fonte de origem), ajuda na banca, mas
**não faz parte do experimento** e não entra nas métricas. Para não custar retrabalho:

- `src/api/`: API HTTP fina (ex.: Fastify) com `GET /sources`, `POST /ask { question, approach }`
  que só chama o mesmo `Retriever` + `generation` usados no benchmark;
- `apps/demo/`: front simples que consome essa API, feito por último.

Assim a demo mostra exatamente o que foi medido, sem lógica própria.

## 5. Fora de escopo

Autenticação, dados reais, deploy em nuvem, upload de documentos pelo usuário.
