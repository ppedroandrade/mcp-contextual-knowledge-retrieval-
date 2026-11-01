# 010 — Congelamento da arquitetura

Data: 01/11/2026 · Situação: aceita

**Commit do congelamento:** `1a1337acf736ede43740d3bb06c03c2d52f5c9f0` (main, merge do PR #14).

**O que fica congelado a partir daqui** (não se ajusta depois de ver o `heldout`):
- as quatro configurações e o código de recuperação (`src/approaches/`, `src/retrieval/`,
  `src/indexing/`, `src/mcp/`), com profundidade 50, k = 5, RRF com c = 60 e uma tool por
  fonte (ADR 004 e 005);
- as três fontes integradas (`docs`, `tickets`, `incidents`); a 4ª só entra pela H3, em branches
  próprias, conforme `docs/h3-protocolo.md` (ADR 009);
- embeddings `bge-m3`, gerador `qwen3:4b-instruct-2507-q4_K_M`, prompt (hash em
  `environment.json`), temperatura 0, semente 42, `num_ctx` 5120, `num_predict` 512 (ADR 003);
- avaliação das respostas: regra dos fatos, rubrica, juiz `qwen3.5:4b` e as notas fixadas por
  regra (ADR 007);
- métricas (`src/evaluation/metrics.ts`) e estatística (ADR 008);
- protocolo de medição: aquecimento descartado, ordem das abordagens embaralhada por rodada,
  Node 22 (ADR 006 e 009).

**Depois do congelamento** só entram: o conjunto `heldout` (criado depois deste commit), a
integração da 4ª fonte nas branches da H3, scripts que executam e resumem o experimento sem
mudar parâmetros, correções de defeitos (registradas aqui, com o motivo) e a documentação.

**Mudanças depois do congelamento:**
- 01/11/2026: integração da 4ª fonte (políticas) aplicada na `main` depois da medida da H3
  (`results/runs/2026-11-01-h3-integracao-politicas`, patch `h3-mcp.patch`). Não muda nada para
  os conjuntos `dev` e `heldout`, que continuam com as três fontes; o servidor MCP iniciado à
  mão (`npm run mcp:server`) passa a expor as quatro por padrão.
- Correções de defeitos:
  - 01/11/2026, **depois da execução final e da v3 do artigo**: mediana das rodadas com número
    par de rodadas (`median` em `src/evaluation/metrics.ts` tomava o central superior;
    `scripts/compare-c-d.ts` tinha cópia própria). Passa a ser a mediana usual, numa única
    implementação (ADR 016). Afeta só a latência de `2026-11-01-heldout-recuperacao` (10
    rodadas); os resultados publicados ficam intactos e o recálculo está em
    `results/recalculos/2026-11-01-mediana-usual/`.
