# assistant
Assistente da empresa (ADR 012, `docs/assistente.md`): protótipo de produto sobre a
configuração D. **Fora do experimento**: só importa o código medido, sem alterá-lo.

- `documents.ts`: leitura de PDF, Word, Markdown, HTML e texto em seções e trechos.
- `connectors.ts`: Confluence (API v2, token) e Google Drive/Docs (OAuth).
- `knowledge.ts`: indexação, sincronização incremental e busca numa fonte.
- `store.ts`: trechos no pgvector (busca exata) ou em memória.
- `workspace.ts`: fontes, documentos e conversas em `.assistente/`; segredos cifrados.
- `mcp.ts`: servidor MCP com uma tool por fonte e o host que funde por RRF.
- `chat.ts`: prompt com trechos numerados, consulta de seguimento e streaming do Ollama.
- `app.ts` e `server.ts`: API HTTP (SSE, upload, OAuth, `/mcp`) e `npm run assistente`.
