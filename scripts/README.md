# scripts
Utilitários: gráficos, conferências e manutenção.

- `compare-c-d.ts <execução>`: confere C × D numa execução gravada em `results/runs/`
  (top-k e métricas iguais por pergunta; diferença de latência D − C).
- `summarize-generation.ts <execução>`: recalcula com o código atual o resumo de uma
  execução de `bench:generation` (sem alterar os arquivos gravados).
- `summarize-answers.ts <execução>`: recalcula com o código atual o resumo de uma execução
  de `eval:answers` (sem alterar os arquivos gravados).
- `lexical-overlap.ts`: sobreposição lexical entre perguntas e evidências (`docs/corpus.md`).
- `h3-diff.ts <congelamento> <customizada> <mcp>`: arquivos e linhas por camada nas duas
  integrações da H3 (`docs/h3-protocolo.md`).
- `h3-segundo-cliente.ts`: cliente MCP mínimo, só com o SDK oficial, que lista e chama as tools
  do servidor (H3, passo 5).
- `experimento-final.sh [etapa...]`: experimento final no Mac, na ordem do ADR 011
  (`docs/experimento-final.md`); `MODO=teste` ensaia sem Ollama nem banco.
- `tabelas-artigo.ts --recuperacao <id> --geracao <id> --respostas <id> --humana <id> --politicas <id> --h3 <id> [--out f.md]`:
  tabelas do artigo a partir das execuções gravadas, com a procedência de cada número e alerta
  para execuções sem valor experimental.
