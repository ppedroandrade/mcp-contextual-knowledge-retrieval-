# api

API HTTP fina para a demonstração (`npm run demo`). Só chama `approaches` + `generation`; nenhuma
lógica própria. Fora do escopo experimental. Ver `docs/arquitetura.md`, seção 4.

- `app.ts`: rotas (`/api/config`, `/api/sources`, `/api/units/:id`, `POST /api/ask`) e entrega do front de `apps/demo/`.
- `eval.ts`: modo de avaliação humana cega (`--avaliacao <planilha>`), que grava as notas no formato da planilha de `eval:human`.
- `server.ts`: monta as abordagens com `src/bench/setup.ts` e escuta em `127.0.0.1:3000`.

Opções: `--port`, `--host`, `--approaches A,B,C,D`, `--embedder ollama|hash`, `--store pg|memory`,
`--llm ollama|simulated`, `--model`, `--avaliacao <id da planilha em results/runs>`.
