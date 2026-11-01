# Assistente da empresa

Protótipo de produto construído sobre a arquitetura do TCC (configuração D, MCP + RAG), com uma
interface de chat como a dos assistentes conhecidos. **Fica fora do experimento**: nada daqui
entra nas métricas (ADR 012).

## Como rodar

```bash
docker compose up -d                 # PostgreSQL + pgvector e Ollama (bge-m3 e qwen3 já baixados)
npm run assistente -- --exemplo      # http://127.0.0.1:3100, com a wiki de exemplo da Orbital
npm run assistente                   # sem a wiki de exemplo: a empresa traz as próprias fontes
npm run assistente -- --embedder hash --store memory --llm simulated   # sem Docker, só para ver a UI
```

O estado (fontes, conversas e tokens cifrados) fica em `.assistente/`, fora do git. Para começar
do zero, apague essa pasta e a tabela `assistente_trechos_ollama_bge_m3` no Postgres.

## Como o contexto funciona

```
  pergunta ──► host ──tools/list──► servidor MCP da empresa
                │                    ├─ buscar_<Arquivos enviados>   ──► trechos mais parecidos
                │   (só as fontes    ├─ buscar_<Google Drive>        ──► trechos mais parecidos
                │    da conversa)    └─ buscar_<Confluence>          ──► trechos mais parecidos
                ▼
        fusão RRF → 5 trechos numerados → qwen3 → resposta com [1], [2]… em streaming
```

1. **Cada fonte vira uma ferramenta de busca** (uma tool MCP). Quando a empresa conecta uma fonte
   nova, a tool aparece sozinha; o assistente não muda.
2. **A cada pergunta,** o assistente consulta as fontes escolhidas no seletor do topo da conversa
   ("Todas as fontes" por padrão). Cada fonte devolve os trechos mais parecidos com a pergunta
   (busca semântica com `bge-m3`), e as listas são fundidas por RRF.
3. **Os 5 melhores trechos vão para o modelo,** numerados. Ele só pode responder com o que está
   neles e cita cada informação como `[n]`. Se não houver resposta, diz que não encontrou.
4. **Na tela,** o *rastro das fontes* mostra quantos trechos vieram de cada fonte. As citações
   ficam realçadas e abrem o trecho original ao lado, com o link para o documento no Drive ou no
   Confluence.
5. **Perguntas de seguimento** ("e o rollback?") são buscadas junto com a pergunta anterior, e os
   últimos 6 turnos da conversa vão para o modelo.

## Como a empresa coloca o conhecimento

Tudo pelo botão **Fontes de conhecimento**, na barra lateral.

### Arquivos

**Enviar arquivos** cria uma fonte (ex.: "RH e Financeiro"); depois é só arrastar os arquivos.
Também dá para clicar no clipe da caixa de mensagem ou soltar arquivos na conversa: eles vão
para a fonte "Arquivos enviados". Formatos: PDF, Word (`.docx`), Markdown, HTML, texto, CSV e
JSON, até 25 MB. PDF escaneado (imagem) precisa de OCR antes.

### Google Drive e Google Docs

Uma vez por servidor, alguém com acesso ao Google Cloud cria as credenciais:

1. Em [console.cloud.google.com](https://console.cloud.google.com), crie um projeto (ou use um
   existente) e ative a **Google Drive API** (APIs e serviços → Biblioteca).
2. Em **Tela de permissão OAuth**, escolha *Interno* (só a sua organização do Google Workspace)
   ou *Externo* com as contas de teste.
3. Em **Credenciais → Criar credenciais → ID do cliente OAuth**, tipo *Aplicativo da Web*, com o
   URI de redirecionamento `http://127.0.0.1:3100/api/conectores/google/retorno`.
4. Coloque o ID e a chave secreta no `.env` e reinicie o assistente:
   ```
   GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=...
   ```

Depois disso, cada pessoa clica em **Google Drive → Conectar conta Google** e autoriza a leitura.
O assistente vê só o que essa conta pode ver; para limitar a uma pasta, informe o ID dela (o
final do endereço da pasta no Drive). **Sincronizar agora** traz o que mudou.

### Confluence (Atlassian)

1. Crie um token de API em [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens).
2. Em **Confluence**, informe o site (`https://empresa.atlassian.net`), a chave do espaço (ex.:
   `ENG`), o e-mail da conta e o token. O token fica cifrado no servidor e não aparece de novo.

O assistente lê as páginas do espaço que a conta pode ver. Cada citação leva à página original.

### Usar as mesmas fontes no Claude ou em outro cliente MCP

O servidor MCP do assistente fica em `http://127.0.0.1:3100/mcp`. No Claude Code:

```bash
claude mcp add --transport http conhecimento-da-empresa http://127.0.0.1:3100/mcp
```

As tools `buscar_<fonte>` aparecem nesse cliente com a mesma lista de fontes da interface.

## Limites do protótipo

- **Sem login nem permissões por pessoa:** quem abre o assistente vê tudo o que foi conectado.
  Por isso ele escuta só em `127.0.0.1`. Usar com `--host 0.0.0.0` na rede expõe as fontes a
  quem acessar.
- **Sincronização manual** (botão), sem webhooks.
- **Conectores do Google e do Confluence** testados com respostas simuladas da API, ainda não
  contra contas reais.
- **Documentos podem conter instruções maliciosas** (*prompt injection*). O prompt manda usar só
  os trechos, mas isso não é uma defesa completa.
- **Velocidade:** na CPU (Ollama no Docker do Mac) uma resposta leva de 7 a 12 s, e a busca nas
  fontes, menos de 0,5 s.

## Caminho para produção

1. Login com o provedor da empresa (Google Workspace, Microsoft Entra, Okta) e filtro dos trechos
   pelas permissões de cada pessoa na origem.
2. Sincronização automática (webhooks do Drive e do Confluence, ou agenda) e fila de ingestão.
3. Mais conectores como novas tools MCP: SharePoint/OneDrive, Notion, Jira, Slack.
4. OCR para PDF escaneado; tabelas e imagens.
5. Modelo maior ou em GPU para respostas mais rápidas; avaliação contínua com a regra dos fatos
   e o juiz do TCC (ADR 007) sobre perguntas reais da empresa.
6. Auditoria, retenção das conversas e conformidade com a LGPD.
