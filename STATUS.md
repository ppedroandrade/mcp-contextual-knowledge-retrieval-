# STATUS

Legenda: **planejado** · **implementado** (código existe) · **testado** (testes automatizados passam) · **validado** (usado em experimento registrado em `results/`).

Decisão de 31/10/2026: repositório começa do zero. O protótipo anterior
(`tcc2-prototipo-revisado.zip`) serve só como referência; os resultados do artigo v2
não têm rastreabilidade com este repositório.

| Item | Situação | Observação |
| --- | --- | --- |
| Estrutura de pastas e documentação inicial | implementado | |
| Ferramental: TypeScript, Vitest, CI, docker-compose | implementado, testado | `npm run check` passa (3 testes unitários de configuração) |
| Tipos compartilhados e interface `Retriever` | implementado | `src/core/types.ts` |
| Escolha de stack | decidido | ADRs 001 a 005 em `docs/decisoes/`; modelo do LLM a fixar |
| Mapeamento TCC 1 → métricas | documentado | `docs/metodologia.md`; divergências listadas |
| Corpus sintético (4 fontes, 146 documentos, 349 fatos) | implementado, testado | `npm run corpus`; `docs/corpus.md` |
| Leitores das fontes (Markdown, JSON, CSV, HTML) | implementado, testado | `src/sources/` |
| Perguntas dev (60) e de políticas (15) com gabarito derivado dos fatos | implementado, testado | `data/questions/` |
| Perguntas heldout (40) | planejado | criar só depois do congelamento da arquitetura |
| Busca textual convencional (A, BM25) | implementado, testado | `src/approaches/a-bm25.ts`; rodada de verificação no dev, não é resultado do experimento |
| Métricas de recuperação (P, R, MRR, nDCG, ER@k) e medição de latência | implementado, testado | `src/evaluation/metrics.ts`, `npm run bench:retrieval` |
| Embeddings (Ollama `bge-m3`) e armazenamento vetorial (pgvector e memória) | implementado, testado em parte | testes unitários com Ollama simulado; teste de integração do pgvector escrito, **ainda não executado** (sem pgvector neste ambiente) |
| RAG tradicional (B), só recuperação | implementado, testado | `src/approaches/b-rag.ts`; geração de resposta ainda não |
| Configuração C (busca por fonte + RRF, sem MCP) | implementado, testado | `src/approaches/c-per-source.ts` |
| Servidor MCP + abordagem MCP + RAG | planejado | |
| Geração de respostas por LLM | planejado | sem serviço pago sem aprovação |
| Métricas e estatística | planejado | conferir metodologia do TCC 1 |
| Benchmark reproduzível | planejado | |
| API + UI de demonstração | planejado (opcional) | depois do benchmark; fora das métricas |

## Próximos passos
1. Validar com o orientador as divergências da seção 3 de `docs/metodologia.md`.
2. Rodar `npm run test:integration` e a ingestão com Ollama numa máquina com Docker.
3. Servidor MCP e configuração D.
4. Avaliar se as perguntas repetem demais as palavras do corpus (ver risco em `docs/metodologia.md`).
