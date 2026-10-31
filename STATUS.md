# STATUS

Legenda: **planejado** · **implementado** (código existe) · **testado** (testes automatizados passam) · **validado** (usado em experimento registrado em `results/`).

Decisão de 31/10/2026: repositório começa do zero. O protótipo anterior
(`tcc2-prototipo-revisado.zip`) serve só como referência; os resultados do artigo v2
não têm rastreabilidade com este repositório.

| Item | Situação | Observação |
| --- | --- | --- |
| Estrutura de pastas e documentação inicial | implementado | |
| Ambiente real: Docker, PostgreSQL + pgvector, Ollama | testado (31/10/2026) | ver "Ambiente validado" abaixo |
| Ferramental: TypeScript, Vitest, CI, docker-compose | implementado, testado | `npm run check` passa (45 testes unitários); imagens fixadas no compose: `pgvector/pgvector:0.8.7-pg16`, `ollama/ollama:0.40.13` |
| Tipos compartilhados e interface `Retriever` | implementado | `src/core/types.ts` |
| Escolha de stack | decidido | ADRs 001 a 006 em `docs/decisoes/`; modelo do LLM a fixar |
| Mapeamento TCC 1 → métricas | documentado | `docs/metodologia.md`; divergências listadas |
| Corpus sintético (4 fontes, 146 documentos, 349 fatos) | implementado, testado | `npm run corpus`; `docs/corpus.md` |
| Leitores das fontes (Markdown, JSON, CSV, HTML) | implementado, testado | `src/sources/` |
| Perguntas dev (60) e de políticas (15) com gabarito derivado dos fatos | implementado, testado | `data/questions/` |
| Perguntas heldout (40) | planejado | criar só depois do congelamento da arquitetura |
| Busca textual convencional (A, BM25) | implementado, testado | `src/approaches/a-bm25.ts`; rodada de verificação no dev, não é resultado do experimento |
| Métricas de recuperação (P, R, MRR, nDCG, ER@k) e medição de latência | implementado, testado | `src/evaluation/metrics.ts`, `npm run bench:retrieval` |
| Embeddings (Ollama `bge-m3`) e armazenamento vetorial (pgvector e memória) | implementado, testado | testes unitários com Ollama simulado; `npm run test:integration` executado em 31/10/2026 (3/3: pgvector = busca exata em memória); ingestão real: 346 unidades, 1024 dimensões, 47 s |
| RAG tradicional (B), só recuperação | implementado, testado | `src/approaches/b-rag.ts`; executado no ambiente real (rodada dev abaixo); geração de resposta ainda não |
| Configuração C (busca por fonte + RRF, sem MCP) | implementado, testado | `src/approaches/c-per-source.ts` |
| Servidor MCP (uma tool por fonte) e configuração D (MCP + RAG), só recuperação | implementado, testado | `src/mcp/`, `src/approaches/d-mcp-rag.ts`; teste confirma C = D nas 60 perguntas e o protocolo real via stdio; no ambiente real, C = D nas 60 perguntas com `bge-m3` + pgvector (`scripts/compare-c-d.ts`) |
| Geração de respostas por LLM | planejado | sem serviço pago sem aprovação |
| Métricas e estatística | planejado | conferir metodologia do TCC 1 |
| Benchmark reproduzível | implementado em parte | `environment.json` grava commit, árvore limpa (ignora `results/`), digest e versão do Ollama e uso de GPU (`sizeVram`); falta a geração |
| API + UI de demonstração | planejado (opcional) | depois do benchmark; fora das métricas |

## Ambiente validado (31/10/2026)

| Item | Valor |
| --- | --- |
| Máquina | Apple M4 Pro, 12 núcleos (8 de desempenho + 4 de eficiência), 24 GB, GPU integrada de 16 núcleos (Metal) |
| Sistema e Node | macOS 27.0, Node.js 26.13.0 (o ADR 001 e o CI usam 22; `engines` aceita ≥ 22.12) |
| Docker | Docker Desktop 4.48.0 (engine 28.5.1); VM com 12 CPUs e 7,7 GiB |
| PostgreSQL / pgvector | 16.15 / 0.8.7 |
| Ollama | 0.40.13, **no Docker, só CPU** (`sizeVram: 0`): no macOS o Docker não acessa a GPU. Decisão do Pedro em 31/10/2026: manter o Ollama no Docker, como no compose |
| Embeddings | `bge-m3`, digest `7907646426070047a77226ac3e684fbbe8410524f7b4a74d02837e43f2146bab` |

## Rodadas registradas

| Execução | O que é | Situação |
| --- | --- | --- |
| `results/runs/2026-10-31-dev-bge-m3` | A, B, C, D no `dev`, `bge-m3` + pgvector, 5 rodadas de latência | **rodada de verificação no conjunto dev; não é o resultado final do experimento** |
| `results/runs/2026-10-31-dev-hash-memoria-c-d` | C e D com embedding `hash` e armazenamento em memória, para isolar o custo do protocolo | diagnóstico; **sem valor experimental** (embedding não semântico) |

Rodada `2026-10-31-dev-bge-m3` (commit `1cac716`, 54 perguntas com resposta; latência = média
das medianas por pergunta, em ms):

| | P@5 | R@5 | MRR@5 | nDCG@5 | ER@5 | ER@5 multifonte | completas@5 | latência |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A-bm25 | 0,244 | 0,880 | 0,944 | 0,858 | 0,593 | 0,458 | 0,500 | 0,17 |
| B-rag | 0,233 | 0,861 | 0,900 | 0,826 | 0,593 | 0,333 | 0,500 | 78,8 |
| C-por-fonte | 0,252 | 0,907 | 0,882 | 0,856 | 0,481 | 0,417 | 0,352 | 243,4 |
| D-mcp | 0,252 | 0,907 | 0,882 | 0,856 | 0,481 | 0,417 | 0,352 | 247,2 |

Conferências (`npx tsx scripts/compare-c-d.ts <execução>`):
- **C = D:** top-5 e métricas idênticos nas 60/60 perguntas.
- **D − C é só o protocolo:** na rodada de diagnóstico, em que a busca quase não custa nada,
  D − C por pergunta teve mediana de 0,42 ms (p25 0,41; p75 0,44) e D foi mais lento em
  60/60 perguntas. Na rodada com `bge-m3`, D − C teve mediana de 2,68 ms, mas p25 de −12,85 e
  p75 de 16,39 ms (D mais lento em 35/60): o custo do protocolo fica abaixo do ruído das
  chamadas de embedding na CPU (IQR por pergunta de C: 22,1 ms). Sem teste estatístico ainda.
- C e D fazem 3 chamadas de embedding por pergunta (uma por fonte, ADR 005) e B faz 1; a
  latência de C ficou cerca de 3 vezes a de B.

## Próximos passos
1. Validar com o orientador as divergências da seção 3 de `docs/metodologia.md`.
2. Geração de respostas por LLM (mesmo prompt para B, C e D).
3. Avaliar se as perguntas repetem demais as palavras do corpus (ver risco em `docs/metodologia.md`).
4. Antes do experimento final: fixar uma única versão do Node para as medições (hoje 26.13
   local × 22 no ADR 001 e no CI); medir dentro de D o tempo gasto na tool, para separar o
   protocolo da busca como pede o ADR 004; rodar sem outras cargas na máquina e repetir
   execuções, porque a latência varia entre execuções iguais.
