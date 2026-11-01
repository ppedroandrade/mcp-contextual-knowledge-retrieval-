# 012 — Assistente da empresa (protótipo de produto, fora do experimento)

Data: 01/11/2026 · Situação: aceita

**Contexto.** Depois da execução final, o Pedro pediu uma versão de uso real: uma interface no
estilo dos assistentes de chat, em que a empresa coloca o próprio conhecimento (arquivos, Google
Drive/Docs, Confluence). A arquitetura do experimento está congelada (ADR 010) e a demonstração
existente (`npm run demo`) só mostra o corpus sintético, para comparar as configurações.

**Decisão.**
- **Código separado:** `src/assistant/` e `apps/assistant/` (`npm run assistente`, porta 3100).
  Nenhum arquivo medido no TCC muda; o assistente só importa, sem alterar, o embedder (`bge-m3`),
  o cosseno e o tipo das mensagens do LLM.
- **A mesma arquitetura da configuração D:** cada fonte da empresa é uma tool `buscar_<fonte>`
  de um servidor MCP; a cada pergunta o host descobre as tools com `tools/list`, chama as das
  fontes escolhidas na conversa e funde as listas por RRF (c = 60); os 5 primeiros trechos vão ao
  LLM (`qwen3:4b-instruct-2507` no Ollama, temperatura 0), que cita cada trecho como `[n]`. Uma
  fonte nova é uma tool nova, sem mudança no host, e o servidor avisa os clientes
  (`tools/list_changed`): é a H3 na prática.
- **O mesmo servidor MCP em `/mcp`** (Streamable HTTP, sem estado, com proteção contra DNS
  rebinding), para outros clientes MCP (Claude Code, Claude Desktop) usarem as mesmas fontes.
- **Fontes:**
  - **Upload:** PDF (`unpdf` 1.9.0), Word `.docx` (`mammoth` 1.13.0), Markdown, HTML, texto,
    CSV e JSON, até 25 MB por arquivo. As duas bibliotecas são abertas (MIT e BSD-2), rodam no
    Node e foram fixadas em versões com mais de duas semanas.
  - **Google Drive/Docs:** OAuth 2.0 do próprio usuário, escopo `drive.readonly`. Google Docs é
    exportado como HTML, para manter as seções; PDF, Word e texto são baixados. A busca pode se
    restringir a uma pasta.
  - **Confluence Cloud:** API REST v2 com e-mail + token de API; lê as páginas de um espaço.
  - **Sincronização:** manual, incremental pela data de atualização; o que some na origem sai
    do índice; documento ilegível é registrado sem parar a sincronização.
- **Ingestão:** leitura → seções (títulos do documento) → trechos de até 1 200 caracteres →
  `bge-m3` → pgvector, numa tabela própria e com busca exata (ADR 002).
- **Estado local em `.assistente/`, fora do git:** fontes, documentos e conversas em JSON; os
  segredos dos conectores ficam cifrados com AES-256-GCM (chave em `ASSISTENTE_CHAVE` ou em
  `.assistente/chave`) e nunca são devolvidos pela API.
- **Conversa:** os 6 turnos anteriores vão no prompt; uma pergunta curta de seguimento ("e o
  rollback?") é buscada junto com a anterior; a resposta chega em streaming (SSE).

**Fora do protótipo, necessário para produção.**
- **Acesso:** login/SSO e permissões por pessoa. Hoje quem abre o assistente vê tudo o que foi
  conectado: no Google, o que a conta que conectou pode ver; no Confluence, o que o token pode ver.
- **Escala e operação:** várias empresas no mesmo servidor, sincronização automática (webhooks
  ou agenda), OCR de PDF escaneado e outros conectores (SharePoint/OneDrive, Notion, Jira, Slack).
- **Segurança:** defesa contra instruções maliciosas escondidas nos documentos (*prompt
  injection*) e auditoria de quem perguntou o quê.
- **Google:** o escopo `drive.readonly` é restrito. Uso interno ou em teste não exige a
  verificação do Google; publicar o app para fora da organização exige.

**Consequências.** Não entra nas métricas do TCC. Pode aparecer no artigo como demonstração da
arquitetura, sem números. Testes: 22 unitários (`test/unit/assistant.test.ts`), com `fetch`
simulado nos conectores e um PDF gerado no teste. Verificado com `bge-m3` + `qwen3`, com um
`.docx`, um PDF e a wiki de exemplo. **Os conectores do Google e do Confluence não foram testados
contra contas reais**, por falta de credenciais.
