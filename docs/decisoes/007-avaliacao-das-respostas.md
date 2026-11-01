# 007 — Avaliação das respostas (H2)

Data: 31/10/2026 · Situação: aceita

**Contexto.** A H2 pede avaliação humana especializada e métricas automatizadas da qualidade
das respostas. O TCC 1 cita o RAGAS, que é Python e depende de um LLM avaliador
(`docs/metodologia.md`, seção 3, item 3). B, C e D geram respostas com o mesmo LLM (ADR 003);
A só recupera.

**Decisão.**
1. **Unidade avaliada:** cada resposta distinta, isto é, (pergunta, trechos entregues,
   texto). C e D dão respostas idênticas e viram um item só; a nota vale para as duas. Duas
   linhas iguais na planilha revelariam ao avaliador quais respostas são do MCP. Os trechos
   entram na chave porque a sustentação depende deles.
2. **Rubrica única** (`src/evaluation/rubric.ts`), notas inteiras de 1 a 5, para o juiz e
   para os avaliadores humanos: correção e completude (contra a resposta de referência) e
   sustentação nos trechos entregues.
3. **Checagem por regra, a âncora** (`src/evaluation/facts.ts`): para cada fato de que a
   pergunta depende (`factIds`), o valor, sem o rótulo de campo do corpus ("Serviço afetado:
   x" → "x"), aparece na resposta? *Literal*: os termos em sequência; *cobertura*: a fração
   dos termos, com a normalização da busca. Acerto pela regra = abstenção nas perguntas sem
   resposta e todos os fatos literais nas demais. Determinística e sem custo; estrita com
   paráfrases.
4. **Notas que a rubrica fixa, aplicadas por regra:** quem só diz "não sei" não afirma nada
   (sustentação 5) e acerta só se o corpus não tem a resposta (5/5/5; com resposta no
   corpus, 1/1/5); quem afirma algo numa pergunta sem resposta erra (correção e completude
   1). O juiz só avalia o resto, ou seja, as respostas afirmativas.
5. **Juiz:** `qwen3.5:4b`, digest
   `d8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04`, temperatura 0,
   semente 42, `num_ctx` 8192, `num_predict` 128, modo de raciocínio desligado e saída JSON
   com esquema (`src/evaluation/judge.ts`). Prompt e esquema fixos; o hash é gravado em cada
   execução e fixado num teste. Configurável por `JUDGE_MODEL`.
6. **Avaliação humana** (`npm run eval:human`): planilha cega com uma linha por item, ordem
   embaralhada com semente fixa, ids `R001…` sem relação com a abordagem, separador `;` para
   o Excel em português; chave separada, que não vai para os avaliadores; instruções com a
   mesma rubrica. Pelo menos 2 avaliadores; concordância pelo alfa de Krippendorff ordinal,
   conferido contra o exemplo de Krippendorff (2011).
7. **RAGAS não é usado.** A divergência da seção 3, item 3, de `docs/metodologia.md` fica
   resolvida pela opção (a): métricas equivalentes em TypeScript com o LLM local (correção
   ≈ *answer correctness*; sustentação ≈ *faithfulness*), mais a checagem por regra.

**Escolha do juiz.** Candidatos diferentes do gerador (`qwen3:4b-instruct-2507`), cada um
avaliando os 120 itens da rodada `2026-10-31-dev-geracao-qwen3-4b` duas vezes, em todos os
itens (`results/runs/2026-10-31-juiz-candidato-*`, commit `df9b4a0`; resumo com a pontuação
atual por `scripts/summarize-answers.ts`):

| | `qwen3.5:4b` | `gemma3:4b` |
| --- | --- | --- |
| Família | Qwen (a do gerador, outro modelo) | Gemma |
| Itens com as mesmas notas nas 2 passadas, na mesma ordem | 120/120 | 116/120 |
| Alfa ordinal entre as passadas (correção / completude / sustentação) | 1 / 1 / 1 | 0,975 / 0,983 / 0,962 |
| Casos fixados pela rubrica em que o juiz diverge na correção | 21/46 | 32/46 |
| Juiz × regra nas respostas afirmativas (correção ≥ 4 × todos os fatos literais) | 74,3%; κ = 0,35 | 73,0%; κ = 0,31 |

Os dois deram nota alta a "não sei" quando o corpus tinha a resposta, contra a rubrica: é o
motivo do item 4. Nas respostas afirmativas, os dois concordam com a regra quando ela acha
todos os fatos (47/47) e são lenientes quando faltam fatos (19 e 20 de 27 com correção ≥ 4).
Escolhido o `qwen3.5:4b`: o mais repetível e o que mais segue a rubrica. Risco aceito: é da
mesma família do gerador, o que pode favorecer o estilo das respostas; declarado como ameaça
à validade.

**Repetibilidade entre execuções.** As 2 passadas da calibração seguiam a mesma ordem, e o
juiz repetia a mesma sequência de pedidos. Numa execução seguinte, com outra sequência
(`2026-10-31-dev-avaliacao-qwen3-5`, só as 74 respostas afirmativas), o juiz repetiu a nota
da calibração em 67 de 74 itens (`scripts/compare-judge-runs.ts`): a decisão "correção ≥ 4"
foi a mesma em 73/74, e o alfa ordinal foi 0,956 na correção, 0,996 na completude e **0,617
na sustentação**. Por isso as repetições além da primeira passaram a usar ordem embaralhada;
na avaliação de referência (`2026-10-31-dev-avaliacao-qwen3-5-r2`), a 1ª repetição, na ordem dos
itens, reproduziu exatamente a execução anterior (74/74, mesma sequência de pedidos), e a 2ª,
embaralhada, repetiu a nota em 71 de 74 itens, com a mesma decisão de correção em 74/74 e
alfa ordinal de 0,933, 0,997 e 1,000. Com a mesma sequência de pedidos o juiz é
reproduzível; mudar a sequência muda algumas notas, quase nunca a decisão de correção. A
nota usada é a da 1ª repetição, na ordem fixa dos itens.

**Consequências.**
- O juiz não substitui a avaliação humana nem a regra: os três são reportados lado a lado.
  Como o juiz é leniente com respostas parciais, a correção automática se lê pela regra e
  pelo juiz juntos.
- A sustentação dada pelo juiz foi a nota menos estável numa das comparações (alfa 0,617) e
  fica a mais alta de todas (perto de 5). Para a sustentação, valem também a citação válida
  (`citacaoInvalida`, determinística, na geração) e a avaliação humana.
- Os avaliadores veem os trechos. Um avaliador atento pode notar que o contexto de C e D
  mistura as três fontes, mas não consegue distinguir C de D.
- Ao trocar de LLM no Ollama, esperar a descarga (`/api/ps` vazio): o `ollama stop` volta
  antes de liberar a memória, e numa troca o runner anterior foi morto por falta de memória.
