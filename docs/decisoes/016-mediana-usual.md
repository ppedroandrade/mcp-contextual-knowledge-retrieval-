# 016 — Mediana usual em todo o código medido (correção posterior ao experimento)

Data: 01/11/2026 · Situação: aceita · Registrada **depois** da execução final (commit `2042154`)
e da redação da v3 do artigo. Não é uma decisão anterior ao experimento.

**Contexto.** A revisão do artigo encontrou duas medianas diferentes no código:
- `median` em `src/evaluation/metrics.ts`, usada nos resumos do bench (`summary.json`) e, via
  `src/bench/stats.ts`, para resumir as rodadas de cada pergunta antes dos testes, tomava o
  **central superior** quando o número de rodadas era par;
- `medianOf` em `src/evaluation/stats.ts`, usada como estimador das diferenças e no bootstrap,
  já era a mediana usual (média dos dois centrais);
- `scripts/compare-c-d.ts` tinha uma terceira cópia (central superior) e quantis pelo posto mais
  próximo, ⌊p·(n − 1)⌋, cuja "mediana" das diferenças era, com n par, o central **inferior**.

Com número ímpar de rodadas as três coincidem. Só a execução `2026-11-01-heldout-recuperacao`
(10 rodadas, ADR 011) foi afetada; a geração e o conjunto de políticas (5 rodadas) e as rodadas
`dev` (5, 3 e 1) não mudam. O ADR 008 diz "mediana das rodadas"; o central superior não é o
estimador que o texto descreve, e por isso é tratado como defeito.

**Decisão.**
1. Uma única implementação: `medianOf` (`src/evaluation/stats.ts`), mediana usual, com NaN para
   lista vazia. `median` em `metrics.ts` passa a ser essa mesma função; `scripts/compare-c-d.ts`
   usa `medianOf` e o `quantile` tipo 7 da estatística.
2. Testes unitários para n par e ímpar, para a igualdade entre os dois nomes e para o resumo do
   bench e as medidas por pergunta com n par (`test/unit/stats.test.ts`).
3. **Nenhum resultado bruto é alterado nem regravado.** `results/runs/*/summary.json` e
   `estatistica*.json` ficam como foram publicados. O recálculo, a partir dos tempos brutos de
   `per-question.json`, vai para `results/recalculos/2026-11-01-mediana-usual/`
   (`scripts/recalculo-mediana.ts`), com os valores publicados e os recalculados lado a lado.
4. Só as medidas de latência são refeitas, com o mesmo teste, a mesma família de Holm, as mesmas
   10 000 reamostragens e a mesma semente; as de qualidade não dependem da mediana e não são
   repetidas. Nenhuma medição nova foi feita.

**Efeito** (`results/recalculos/2026-11-01-mediana-usual/recalculo.md`): média das medianas de D
113,4 → 109,3 ms; D − A 112,6 [102,5; 122,8] → 105,9 [101,4; 118,3] ms; D − C 1,83 → 1,44 ms,
p de Holm 0,656 → 0,847. Nenhuma conclusão de teste muda de lado (D × A, D × B e C × B continuam
com p < 0,001; D × C continua não significativo, também nos subgrupos).

**Consequências.** O artigo passa a usar os valores recalculados e diz que são posteriores ao
experimento; os valores da v3 ficam registrados no recálculo. Rodar `npm run stats` de novo em
`2026-11-01-heldout-recuperacao` sobrescreveria o `estatistica.json` publicado: não fazer.
