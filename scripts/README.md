# scripts
Utilitários: gráficos, conferências e manutenção.

- `compare-c-d.ts <execução>`: confere C × D numa execução gravada em `results/runs/`
  (top-k e métricas iguais por pergunta; diferença de latência D − C).
- `summarize-generation.ts <execução>`: recalcula com o código atual o resumo de uma
  execução de `bench:generation` (sem alterar os arquivos gravados).
