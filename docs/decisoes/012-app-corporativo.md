# 012 — App corporativo (workspace) fora do experimento

Data: 01/11/2026 · Situação: aceita

**Contexto.** Depois da execução final (ADR 011), o Pedro pediu para ver o protótipo como um
produto: uma UI de chat no estilo dos assistentes comerciais em que a empresa coloca o próprio
conhecimento, por upload de documentos e por conectores com o Google Drive (Docs) e o
Confluence (Atlassian). A arquitetura do experimento está congelada (ADR 010) e as fontes dele
são uma lista fechada (`SourceName`).

**Decisão.** Uma camada separada, `src/workspace/` + `apps/workspace/` (`npm run workspace`),
que **importa** e não altera o código congelado:
- reaproveita `reciprocalRankFusion` (RRF, c = 60), `cosine`, os embedders (`bge-m3`), o
  provedor do Ollama (mesmo `qwen3:4b-instruct-2507`), `parseAnswer` e a frase de abstenção;
- cada fonte conectada (arquivos enviados, cada conta do Google Drive, cada site do Confluence)
  vira uma tool `buscar_<fonte>` de um servidor MCP próprio do workspace. O host lista as tools a
  cada pergunta, chama todas e funde por RRF, como a configuração D (ADR 004 e 005). Fonte nova
  é tool nova, sem mudar o host; o SDK avisa os clientes com `tools/list_changed`;
- no app, servidor e host MCP ficam no mesmo processo, ligados por `InMemoryTransport` (o mesmo
  protocolo JSON-RPC, sem processo extra). O mesmo servidor sai por stdio
  (`npm run workspace:mcp`) para o Claude Desktop ou outro cliente MCP;
- índice próprio (`WorkspaceStore`): pgvector numa tabela `ws_chunks_<modelo>` ou um arquivo
  JSON na pasta de dados, com remoção por documento e por fonte, que a sincronização
  incremental precisa e o `VectorStore` do experimento não tem;
- sincronização incremental pela versão de cada documento (data de modificação no Drive, número
  da versão no Confluence, SHA-256 no upload): só o que mudou é reextraído e reindexado; o que
  sumiu da origem sai do índice; a falha de um documento não derruba a fonte e mantém a versão
  anterior;
- prompt próprio (respostas de até 6 frases, histórico de 4 turnos) e janela de 12.288 tokens,
  porque 5 trechos de até 1.200 caracteres não cabem nos 5.120 tokens fixados no benchmark;
- conectores com `fetch` injetável e APIs simuladas (`connectors/mock.ts`, empresa fictícia),
  porque não há conta Google nem Atlassian no ambiente de desenvolvimento;
- leitura de PDF com `unpdf` (MIT, sem serviço externo); `.docx` lido direto do ZIP, sem
  dependência.

**Consequências.** Nada do workspace entra nas métricas nem no artigo como resultado; o
experimento continua reproduzível no commit da execução final. O workspace não tem login nem
multiusuário: roda em 127.0.0.1 e guarda os tokens em `workspace-data/credentials.json`
(permissão 600, fora do git). Os limites estão em `docs/workspace.md`.
