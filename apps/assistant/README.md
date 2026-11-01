# Nexo — conhecimento da equipe

Interface do assistente da empresa (ADR 012), com visual inspirado em aplicativos nativos:
barra lateral recolhível, monograma “N”, tipografia do sistema, verde mineral como destaque e uma visão geral centrada
na consulta. HTML, CSS e JavaScript, sem etapa de build.
Ícones da interface em Lucide e logos oficiais do Google Drive e do Confluence, servidos
localmente. Origem, licenças e regeneração em [ICONS.md](ICONS.md).

- **Início:** título curto, campo de consulta central e uma linha sobre as citações.
  Sem documentos, mostra uma única ação para adicioná-los. Fontes e guia ficam na navegação. O seletor de fontes acompanha o campo de mensagem.
- **Biblioteca:** criar fontes de upload, conectar Google Drive e Confluence, enviar arquivos,
  sincronizar e abrir a lista de documentos. A integração MCP fica em uma seção expansível.
- **Consulta:** respostas em streaming, filtro de fontes, histórico e painel do trecho original.
- **Guia rápido:** explica a sequência documento → pergunta → conferência na origem.
- **Aparência:** seletor no topo com Claro, Escuro e Automático. A escolha é salva neste
  navegador; no automático, acompanha o sistema. Tema aplicado antes do CSS para evitar
  clarão na abertura, com sincronização entre abas.
- **Acessibilidade:** navegação por teclado, foco contido na biblioteca, retorno de foco ao
  fechar painéis, anúncios de status, movimento reduzido e menu móvel com fundo clicável.

```bash
npm run assistente -- --exemplo
# http://127.0.0.1:3100 — requer Ollama e PostgreSQL configurados

# Prévia sem serviços externos, com dados temporários e resposta simulada:
npm run assistente -- --exemplo --embedder hash --store memory --llm simulated
```

## Verificação da interface

```bash
npx playwright install chromium  # apenas na primeira execução
npm run test:ui
```

Os testes abrem instâncias isoladas nas portas 3198 e 3199, com estado temporário,
embedding hash e resposta simulada. Cobrem desktop e viewport móvel: início,
seletor de fontes, guia, pergunta, citações, histórico, formulário, foco e primeiro upload.
Também conferem temas, persistência após recarregar, mudanças no sistema, sincronização
entre abas e funcionamento com armazenamento local bloqueado. A navegação recolhível também é conferida
quanto à preservação do rascunho e ao retorno de foco.
Não usam `.assistente/`, Ollama, PostgreSQL nem credenciais reais dos conectores.
Capturas e traces ficam em `test-results/` (ignorado pelo Git).

Os testes da interface não são medições do experimento do TCC.
