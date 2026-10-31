# 002 — Banco vetorial

Data: 31/10/2026 · Situação: aceita

**Contexto.** RAG tradicional e MCP + RAG precisam de busca por similaridade sobre os
mesmos vetores. O corpus sintético é pequeno (centenas a poucos milhares de trechos).

**Decisão.** PostgreSQL 16 com a extensão pgvector, via `docker-compose.yml`
(imagem `pgvector/pgvector:pg16`). Cliente `pg` no Node. Busca exata (sem índice
aproximado) enquanto o corpus for pequeno, para que diferenças entre abordagens não
venham de aproximação do índice.

**Opções descartadas.** Qdrant (mais um serviço e outra API sem ganho para este
tamanho); vetores em memória (deixaria o RAG sem um componente de infraestrutura
realista).

**Consequências.** Registrar no artigo que a busca é exata. Se o corpus crescer,
avaliar HNSW e documentar o efeito na latência.
