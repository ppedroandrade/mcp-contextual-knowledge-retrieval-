# 008 — Estatística inferencial

Data: 01/11/2026 · Situação: aceita

**Contexto.** O TCC 1 prevê estatística descritiva e Mann-Whitney U com α = 0,05 (H1). Todas
as configurações respondem às mesmas perguntas, então as observações são pareadas por
pergunta, e o Mann-Whitney U (amostras independentes) ignora esse pareamento
(`docs/metodologia.md`, seção 3, item 2).

**Decisão.** `src/evaluation/stats.ts`, `src/evaluation/compare.ts` e `npm run stats -- --run <id>`:

1. **Unidade:** a pergunta. Latência por pergunta = mediana das rodadas medidas (a mesma dos
   resumos do bench); métricas de recuperação só nas perguntas com resposta; notas das
   respostas por item distinto, copiadas para todas as configurações que deram a resposta
   (C e D, ADR 007).
2. **Teste principal:** Wilcoxon de postos sinalizados, pareado e bilateral, sobre as
   diferenças por pergunta; diferenças nulas descartadas; exato se n ≤ 50 e sem empates,
   senão aproximação normal com correção de empates, sem correção de continuidade.
3. **Pares**, sempre (com a mudança, sem a mudança): **D × A** (H1, MCP + RAG contra a busca
   textual), **D × B** (MCP + RAG contra o RAG tradicional, H2), **C × B** (estratégia) e
   **D × C** (protocolo). Na geração, sem A.
4. **Várias comparações:** Holm dentro de cada medida, sobre os pares testados. Um par igual em
   todas as perguntas (C × D na qualidade) não é testado nem entra na família.
5. **Tamanho do efeito e incerteza:** diferença por pergunta (mediana para latência; média
   para métricas e notas, que muitas vezes são 0/1), com IC 95% por bootstrap percentil
   (10.000 reamostragens das perguntas, semente 42), e correlação bisserial de postos.
6. **Mann-Whitney U** bilateral (com correção de continuidade e de empates; exato até 8 por
   grupo sem empates), com Holm na mesma família e delta de Cliff, reportado ao lado, para
   cumprir o texto do TCC 1.
7. **Leitura:** significativo se p de Holm do Wilcoxon < 0,05. A ferramenta escreve só o
   sentido ("D pior que A"); a ligação com cada hipótese é feita no texto, sem reformular a
   hipótese depois de ver os dados (ADR 006).

**Conferência.** Os testes unitários comparam Wilcoxon, Mann-Whitney e Holm com o SciPy 1.18.1
e o statsmodels (valores calculados num script auxiliar Python, fora do repositório), nos
casos exato, com empates e com n > 50.

**Consequências.** A saída fica em `results/runs/<id>/estatistica.json`, com o commit do
código e o da execução. A latência com geração tem ruído entre rodadas de até ~500 ms
(deriva térmica, ordem): um p pequeno em D × C nessa medida não é efeito do protocolo se as
respostas e os trechos forem idênticos e o custo medido do MCP for de décimos de ms; isso é
lido junto com `scripts/compare-c-d.ts` e com o tempo da tool dentro de D.
