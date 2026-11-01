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
| Escolha de stack | decidido | ADRs 001 a 007 em `docs/decisoes/`; LLM fixado em 31/10/2026 (ADR 003); juiz e avaliação das respostas (ADR 007) |
| Mapeamento TCC 1 → métricas | documentado | `docs/metodologia.md`; divergências listadas |
| Corpus sintético (4 fontes, 146 documentos, 349 fatos) | implementado, testado | `npm run corpus`; `docs/corpus.md` |
| Leitores das fontes (Markdown, JSON, CSV, HTML) | implementado, testado | `src/sources/`; o leitor HTML foi retirado antes do congelamento (ADR 009) e reintegrado na medida da H3 |
| Perguntas dev (60) e de políticas (15) com gabarito derivado dos fatos | implementado, testado | `data/questions/` |
| Congelamento da arquitetura | registrado | commit `1a1337acf736ede43740d3bb06c03c2d52f5c9f0` (ADR 010) |
| Perguntas heldout (40) | implementado, testado | criado depois do congelamento (ADR 010): `data/questions/heldout.json`, `src/corpus/heldout.ts`; 18 fonte única, 18 multifonte, 4 sem resposta; 20 literais e 16 parafraseadas (sobreposição lexical 0,554 × 0,232; `docs/corpus.md`); **ainda não executado** |
| Busca textual convencional (A, BM25) | implementado, testado | `src/approaches/a-bm25.ts`; rodada de verificação no dev, não é resultado do experimento |
| Métricas de recuperação (P, R, MRR, nDCG, ER@k) e medição de latência | implementado, testado | `src/evaluation/metrics.ts`, `npm run bench:retrieval` |
| Embeddings (Ollama `bge-m3`) e armazenamento vetorial (pgvector e memória) | implementado, testado | testes unitários com Ollama simulado; `npm run test:integration` executado em 31/10/2026 (3/3: pgvector = busca exata em memória); ingestão real: 346 unidades, 1024 dimensões, 47 s |
| RAG tradicional (B) | implementado, testado | `src/approaches/b-rag.ts`; executado no ambiente real, com e sem geração (rodadas dev abaixo) |
| Configuração C (busca por fonte + RRF, sem MCP) | implementado, testado | `src/approaches/c-per-source.ts` |
| Servidor MCP (uma tool por fonte) e configuração D (MCP + RAG), só recuperação | implementado, testado | `src/mcp/`, `src/approaches/d-mcp-rag.ts`; teste confirma C = D nas 60 perguntas e o protocolo real via stdio; no ambiente real, C = D nas 60 perguntas com `bge-m3` + pgvector (`scripts/compare-c-d.ts`) |
| Geração de respostas por LLM (B, C, D) | implementado, testado | `src/generation/`, `npm run bench:generation`; Ollama `qwen3:4b-instruct-2507` (ADR 003); prompt fixo, temperatura 0, os mesmos 5 trechos; A fica só na recuperação; executado no dev (abaixo) |
| Avaliação das respostas: regra dos fatos, juiz por LLM, planilha cega e importação das notas humanas | implementado, testado | `src/evaluation/`, `npm run eval:answers`, `npm run eval:human` (ADR 007); executado no dev (abaixo); avaliação humana **ainda não feita** (faltam os avaliadores) |
| Estatística (Wilcoxon, Holm, bootstrap, Mann-Whitney) | implementado, testado | `src/evaluation/stats.ts`, `src/evaluation/compare.ts`, `npm run stats -- --run <id>` (ADR 008); testes conferidos contra o SciPy 1.18.1 e o statsmodels; aplicada às rodadas dev (abaixo), que **não são o resultado final** |
| H3: integração da 4ª fonte em duas variantes e segundo cliente MCP | executado (passos 1–5) | `results/runs/2026-11-01-h3-integracao-politicas`; customizada 5 arquivos +43 −9, MCP 7 arquivos +56 −11, host intocado nas duas; segundo cliente (só o SDK) usou `buscar_policies` sem alteração no servidor (embedder hash). Leitura e limitações em `docs/h3-protocolo.md`. Integração aplicada na `main` depois da medida (ADR 010). Passo 6 (bench `policies` com `bge-m3`) pendente no Mac |
| Tempo da tool dentro de D | implementado, testado | `tempoMs` em cada tool; `toolMs` no bench só para D; `scripts/compare-c-d.ts` imprime D − tool (ADR 009); ainda sem execução real |
| Node fixado nas medições | implementado | `.nvmrc` 22, `engines` `^22.12.0`, CI pelo `.nvmrc`; `bench:*` recusa outra versão (ADR 009) |
| Benchmark reproduzível | implementado | `environment.json` grava commit lido na partida, árvore limpa (ignora `results/`), digests e versão do Ollama, uso de GPU (`sizeVram`), hash do prompt e fonte de energia |
| API + UI de demonstração | implementado, testado | `npm run demo`; `src/api/`, `apps/demo/`; testes em `test/unit/api.test.ts` (hash + memória + LLM simulado); conferida no navegador com `--embedder hash --store memory --llm simulated` (D pelo stdio real). Ainda não aberta com bge-m3 + qwen3. Fora das métricas |
| Modo de avaliação humana cega na UI | implementado, testado | `npm run demo -- --avaliacao <planilha>`: só Node, sem Ollama; uma resposta distinta por vez, sem pista da abordagem; grava `avaliacoes-ui/<avaliador>.csv` no formato da planilha cega (lido por `eval:human --import`); mostra o alfa de Krippendorff com 2 ou mais avaliadores; testes em `test/unit/eval-ui.test.ts`; conferido no navegador com a planilha piloto do dev. **Nenhuma avaliação humana feita ainda** |

## Ambiente validado (31/10/2026)

| Item | Valor |
| --- | --- |
| Máquina | Apple M4 Pro, 12 núcleos (8 de desempenho + 4 de eficiência), 24 GB, GPU integrada de 16 núcleos (Metal) |
| Sistema e Node | macOS 27.0, Node.js 26.13.0 nas rodadas dev; a partir do ADR 009 as medições exigem Node 22 (`.nvmrc`) |
| Docker | Docker Desktop 4.48.0 (engine 28.5.1); VM com 12 CPUs e 7,7 GiB |
| PostgreSQL / pgvector | 16.15 / 0.8.7 |
| Ollama | 0.40.13, **no Docker, só CPU** (`sizeVram: 0`): no macOS o Docker não acessa a GPU. Decisão do Pedro em 31/10/2026: manter o Ollama no Docker, como no compose |
| Embeddings | `bge-m3`, digest `7907646426070047a77226ac3e684fbbe8410524f7b4a74d02837e43f2146bab` |
| LLM | `qwen3:4b-instruct-2507-q4_K_M`, digest `0edcdef34593eac1aa2be9c7d06c432dcf81945adca5eca2f27662c18f168ba0`; temperatura 0, semente 42, `num_ctx` 5120, `num_predict` 512 |
| Juiz | `qwen3.5:4b`, digest `d8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04`; temperatura 0, semente 42, `num_ctx` 8192, saída JSON (ADR 007) |
| Configuração do Ollama | `OLLAMA_MAX_LOADED_MODELS=2`, `OLLAMA_NUM_PARALLEL=1`, `LLAMA_ARG_CACHE_RAM=0` (ADR 003) |

## Rodadas registradas

| Execução | O que é | Situação |
| --- | --- | --- |
| `results/runs/2026-10-31-dev-bge-m3` | A, B, C, D no `dev`, `bge-m3` + pgvector, 5 rodadas de latência | **rodada de verificação no conjunto dev; não é o resultado final do experimento** |
| `results/runs/2026-10-31-dev-hash-memoria-c-d` | C e D com embedding `hash` e armazenamento em memória, para isolar o custo do protocolo | diagnóstico; **sem valor experimental** (embedding não semântico) |
| `results/runs/2026-10-31-piloto-llm-*` | piloto de três LLMs: B, 60 perguntas, 1 rodada | escolha do modelo (ADR 003); tempos indicativos |
| `results/runs/2026-10-31-dev-geracao-qwen3-4b` | B, C, D com geração no `dev`, aquecimento + 3 rodadas, na tomada | **rodada de verificação no conjunto dev; não é o resultado final do experimento** |
| `results/runs/2026-10-31-juiz-candidato-*` | calibração de dois juízes: os 120 itens, 2 passadas na mesma ordem | escolha do juiz (ADR 007) |
| `results/runs/2026-10-31-dev-avaliacao-qwen3-5` | regra + juiz nas respostas da rodada de geração, 1 passada | evidência da repetibilidade entre execuções (ADR 007) |
| `results/runs/2026-10-31-dev-avaliacao-qwen3-5-r2` | regra + juiz, 2ª passada em ordem embaralhada | **avaliação de referência da rodada dev; não é resultado final** |
| `results/runs/2026-10-31-planilha-cega-dev-piloto` | planilha cega das 120 respostas do `dev` | **piloto do instrumento**; a planilha para os avaliadores sai da execução final no `heldout` |

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

Rodada `2026-10-31-dev-geracao-qwen3-4b` (commit `49c51b9`, 60 perguntas, 6 delas sem
resposta; 77 min na CPU). Abstenção = a resposta diz "Não sei"; "com evidência" = os 5
trechos entregues tinham toda a evidência do gabarito. A correção das respostas ainda não
foi avaliada (próxima etapa). Latência = média das medianas por pergunta, em ms:

| | abstenção correta (6) | com evidência no contexto | abstenção com evidência | abstenção sem evidência | citam trecho | citação inválida | respostas que mudaram | recuperação | recuperação + geração |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B-rag | 6/6 | 27 | 0 | 0,481 | 0,951 | 0,033 | 0 | 60,0 | 6425 |
| C-por-fonte | 6/6 | 19 | 0 | 0,600 | 1,000 | 0,000 | 0 | 143,5 | 6511 |
| D-mcp | 6/6 | 19 | 0 | 0,600 | 1,000 | 0,000 | 0 | 141,8 | 6238 |

Conferências (`scripts/compare-c-d.ts`, `scripts/summarize-generation.ts`):
- **C = D:** mesmos trechos e mesma resposta nas 60/60 perguntas; nenhuma resposta mudou
  entre rodadas; as respostas de B são idênticas às do piloto do mesmo modelo (60/60).
- Os 5 trechos da geração (k = 5) são o top-5 da rodada de recuperação (k = 50) nas 60/60
  perguntas de B, C e D. Nenhuma pergunta seguida teve o mesmo primeiro trecho, então o
  reaproveitamento de prefixo do `llama-server` foi o mesmo para as três (ADR 006).
- **Latência total: o protocolo some no ruído da geração.** D − C por pergunta teve mediana
  de −327 ms (p25 −737; p75 128; D mais lento em 21/60), com as respostas idênticas: não é
  efeito do MCP, cujo custo foi de ~0,4 ms no diagnóstico. A mesma abordagem variou até
  ~500 ms entre rodadas (B: 6224 a 6751 ms de mediana) e o IQR por pergunta de C foi de
  331 ms. Durante a execução o Pedro leu ~115 °C na CPU num monitor externo (leitura não
  registrada; o macOS não acusou limitação térmica). Sem teste estatístico ainda.
- C e D entregam ao LLM menos contextos com toda a evidência que B (19 contra 27), coerente
  com o ER@5 menor na rodada de recuperação.

Avaliação `2026-10-31-dev-avaliacao-qwen3-5-r2` (commit `dc9a741`) das 120 respostas
distintas da rodada de geração (C e D deram as mesmas e contam juntas). Regra: fatos do
gabarito presentes na resposta (literal = termos em sequência); acerto pela regra =
abstenção nas 6 perguntas sem resposta e todos os fatos literais nas demais. Rubrica 1–5:
notas fixadas por regra quando a resposta é "não sei" (46 itens) e juiz `qwen3.5:4b` nas 74
respostas afirmativas. A avaliação humana ainda não foi feita.

| | regra: fatos literais | regra: cobertura de termos | regra: acerto | rubrica: acerto (correção ≥ 4) | correção | completude | sustentação |
| --- | --- | --- | --- | --- | --- | --- | --- |
| B-rag | 0,565 | 0,607 | 0,567 | 0,683 | 3,77 | 3,68 | 4,75 |
| C-por-fonte | 0,426 | 0,455 | 0,417 | 0,600 | 3,40 | 3,32 | 4,93 |
| D-mcp | 0,426 | 0,455 | 0,417 | 0,600 | 3,40 | 3,32 | 4,93 |

Conferências (`scripts/summarize-answers.ts`, `scripts/compare-judge-runs.ts`):
- **Juiz × regra** nas 74 respostas afirmativas: 75,7% de concordância, κ = 0,39. O juiz
  nunca reprovou o que a regra aprovou e aprovou 18 respostas em que faltavam fatos: é
  leniente com respostas parciais.
- **Repetibilidade do juiz:** a 1ª passada reproduziu a execução anterior (74/74); a 2ª,
  em ordem embaralhada, repetiu 71/74 notas e 74/74 decisões de correção (alfa ordinal 0,933 /
  0,997 / 1,000). Entre a calibração e a avaliação, com outra sequência de pedidos, 67/74
  notas e alfa 0,617 na sustentação, a nota menos estável (ADR 007).
- Os juízes candidatos deram nota alta a "não sei" quando o corpus tinha a resposta (21 e 32
  dos 46 casos), contra a rubrica: esses casos passaram a ser pontuados por regra.
- B fica à frente de C e D na regra e na rubrica, coerente com C e D entregarem menos
  contextos com toda a evidência (19 contra 27, rodada de geração). Sem teste estatístico
  ainda.

Estatística das rodadas dev (`npm run stats`, commit `155ebd0`; arquivos
`estatistica.json` nas pastas das execuções). Wilcoxon pareado bilateral com Holm dentro de
cada medida; diferença = 1º − 2º por pergunta (mediana na latência, média nas métricas), IC
95% por bootstrap. **São rodadas de verificação no `dev`; não respondem às hipóteses**, que
dependem da execução final no `heldout`.

| Execução | Medida | Par | Diferença [IC 95%] | p Wilcoxon (Holm) | p Mann-Whitney (Holm) |
| --- | --- | --- | --- | --- | --- |
| `dev-bge-m3` | latência da recuperação (ms) | D × A | +238,2 [229,4; 244,7] | < 0,001 | < 0,001 |
| `dev-bge-m3` | latência da recuperação (ms) | C × B | +158,0 [150,8; 165,6] | < 0,001 | < 0,001 |
| `dev-bge-m3` | latência da recuperação (ms) | D × C | +2,9 [−1,9; 8,3] | 0,24 | 0,49 |
| `dev-bge-m3` | ER@5 | D × B | −0,111 [−0,231; −0,009] | 0,087 | 0,74 |
| `dev-bge-m3` | completas@5 | D × B | −0,148 [−0,278; −0,037] | 0,063 | 0,49 |
| `dev-geracao-qwen3-4b` | recuperação + geração (ms) | D × B | −342,8 [−611,0; 88,6] | 0,43 | 0,75 |
| `dev-geracao-qwen3-4b` | recuperação + geração (ms) | D × C | −322,4 [−570,8; −72,2] | 0,013 | 0,75 |
| `dev-avaliacao-qwen3-5-r2` | acerto pela regra (0/1) | D × B | −0,150 [−0,267; −0,033] | 0,025 | 0,31 |
| `dev-avaliacao-qwen3-5-r2` | acerto pela rubrica (0/1) | D × B | −0,083 [−0,200; 0,050] | 0,39 | 1,00 |
| `dev-avaliacao-qwen3-5-r2` | correção (1–5) | D × B | −0,367 [−0,850; 0,117] | 0,19 | 0,82 |

- No `dev`, D foi mais lento que A em 60/60 perguntas na recuperação, ou seja, no sentido
  contrário à H1. Isso não é o resultado da H1, que sai do `heldout`.
- R@5, MRR@5 e nDCG@5 não tiveram diferença significativa em nenhum par; C × B dá os mesmos
  números que D × B, porque C = D.
- **D × C na recuperação + geração (p de Holm 0,013) não é efeito do protocolo:** trechos e
  respostas são idênticos, o custo do MCP medido no diagnóstico foi de ~0,4 ms e a mesma
  abordagem variou até ~500 ms entre rodadas. O Mann-Whitney não acusa diferença (0,75). É a
  deriva entre rodadas e a ordem de execução, e reforça a necessidade de mais rodadas e de
  medir o tempo da tool dentro de D antes da execução final.
- O Wilcoxon pareado acusa diferenças que o Mann-Whitney não acusa (ex.: acerto pela regra),
  como esperado ao aproveitar o pareamento por pergunta (ADR 008).

## Próximos passos
1. Validar com o orientador as divergências da seção 3 de `docs/metodologia.md`.
2. Executar o experimento final no `heldout` e o passo 6 da H3, no Mac.
3. Conseguir ao menos 2 avaliadores humanos para a H2 (a planilha sai da execução final no
   `heldout`; `results/runs/2026-10-31-planilha-cega-dev-piloto` serve para testar o
   instrumento antes).
5. Antes do experimento final: instalar e usar o Node 22 no Mac (`nvm install 22 && nvm use`);
   fixar e registrar o modo de energia do macOS e, se for o caso, o número de threads do
   Ollama, para reduzir a deriva térmica; mais rodadas de latência com geração (o ruído entre
   rodadas chegou a ~500 ms); rodar na tomada, sem outras cargas e sem trocar de branch durante
   a execução; esperar o Ollama descarregar (`/api/ps` vazio) ao trocar de modelo.