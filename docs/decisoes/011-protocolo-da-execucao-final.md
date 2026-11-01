# 011 — Protocolo da execução final

Data: 01/11/2026 · Situação: aceita · Registrada **antes** de qualquer execução no `heldout`.

**Contexto.** Com a arquitetura congelada (ADR 010) e o `heldout` criado, falta fixar *como* o
experimento final roda e *como* será analisado, antes de ver qualquer número, para que nenhuma
escolha de execução ou de análise dependa do resultado.

**Decisão: execução** (`scripts/experimento-final.sh`, roteiro em `docs/experimento-final.md`).

| Etapa | Comando | Conjunto | Configurações | Repetição |
| --- | --- | --- | --- | --- |
| Recuperação | `bench:retrieval` | `heldout` (40) | A, B, C, D | 10 rodadas + aquecimento |
| Recuperação + geração | `bench:generation` | `heldout` (40) | B, C, D | 5 rodadas + aquecimento (a resposta avaliada é a do aquecimento, ADR 006) |
| Avaliação automática | `eval:answers` | respostas da geração | B, C, D | juiz `qwen3.5:4b`, 2 repetições |
| Avaliação humana | `eval:human` + UI (`npm run demo -- --avaliacao`) | respostas da geração | B, C, D | ≥ 2 avaliadores cegos |
| H3, passo 6 | `bench:retrieval` | `policies` (15, 4 fontes) | A, B, C, D | 5 rodadas + aquecimento |

- Mais rodadas que no `dev` (5 e 3) porque o ruído entre rodadas chegou a ~500 ms na geração
  (STATUS); o número é fixado aqui e não muda depois de ver os dados.
- Mesma máquina (Mac do autor), Node 22, na tomada, sem outras cargas, árvore do git limpa e sem
  trocar de branch; o Ollama descarrega os modelos (`/api/ps` vazio) antes de cada etapa.
- Se uma etapa falhar no meio, ela é **repetida inteira** com outro id, e as duas pastas ficam em
  `results/runs/` (a falha é registrada no STATUS, não apagada).

**Decisão: análise** (ADR 008, sem mudanças).
- Pares: D × A (H1), D × B, C × B (estratégia) e D × C (protocolo); Wilcoxon pareado bilateral,
  Holm dentro de cada medida, IC 95% por bootstrap (10 000 reamostragens), Mann-Whitney como
  complementar (TCC 1); α = 0,05.
- Medidas primárias: H1 — latência da recuperação, D × A; H2 automática — R@5, nDCG@5, ER@5 e
  completas@5 (recuperação) e acerto pela regra, acerto pela rubrica e as notas do juiz (respostas);
  H2 humana — correção, completude e sustentação, média dos avaliadores por item
  (`npm run stats -- --run <planilha>`), com o alfa de Krippendorff ordinal.
- Subgrupos previstos: perguntas `literal` e `parafraseada` (`--style`), relatados como análise
  secundária, sem correção adicional entre os subgrupos.
- Concordância humana baixa (alfa < 0,667) é relatada como limitação; não se descartam avaliadores
  nem itens depois de ver as notas.
- Resultados contrários às hipóteses (ex.: D mais lento que A) são relatados como são (ADR 006).
- As tabelas do artigo saem de `scripts/tabelas-artigo.ts`, que lê só as pastas de
  `results/runs/` e marca execuções sem valor experimental.

**Consequências.** Qualquer desvio deste protocolo (outra contagem de rodadas, outro juiz, uma
etapa repetida) é registrado aqui, com o motivo, antes de entrar no artigo.

**Desvios:**
- 01/11/2026, avaliação humana: os dois avaliadores avaliaram **em conjunto**, discutindo cada
  item, e entregaram notas de consenso (as duas planilhas recebidas eram idênticas byte a byte).
  O protocolo pedia ≥ 2 avaliadores independentes e o alfa de Krippendorff entre eles, que, nesse
  caso, daria 1,00 por construção. Decisão: importar uma única planilha
  (`consenso-2-avaliadores`), não relatar concordância entre avaliadores e, no lugar dela, medir a
  concordância entre o consenso humano e o juiz automático (`scripts/humano-x-juiz.ts`,
  `humano-x-juiz.json`). Refazer a avaliação de forma independente não resolveria, porque os
  avaliadores já tinham discutido as notas. Os nomes dos avaliadores não são versionados.
- A execução automática (recuperação, geração, juiz e políticas) não teve desvios.
