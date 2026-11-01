# 013 — Interface Nexo

Data: 01/11/2026 · Situação: aceita

**Contexto.** O Pedro pediu uma nova branch e uma interface mais didática, bonita e próxima
da linguagem visual da Apple, com menos aparência de um chat genérico.

**Decisão.**
- A interface de produto passa a se apresentar como **Nexo**, com início centrado na consulta,
  biblioteca de fontes e guia rápido acessíveis pela navegação. Mantém a implementação em HTML, CSS e JavaScript,
  sem framework ou etapa de build: o novo layout não exige mudança de arquitetura da aplicação.
- Usa fontes do sistema, cores neutras claras, destaque verde mineral e navegação lateral. No celular,
  a navegação abre sobre a página e pode ser fechada pelo fundo ou pela tecla Escape.
- A consulta usa o mesmo formulário na visão geral e na conversa. O histórico, streaming,
  uploads, conectores e citações continuam usando as APIs existentes.
- Informações de modelo ficam no título auxiliar do status; a configuração MCP fica numa
  seção expansível da biblioteca. As contagens vêm das fontes conectadas.
- Playwright entra apenas como dependência de desenvolvimento, com testes no Chromium em
  desktop e viewport móvel. Os servidores de teste usam estado temporário, embedding hash e
  LLM simulado, em portas distintas da aplicação do usuário.
- Ícones de interface vêm de `lucide-static`, em versão fixada e somente como dependência de
  desenvolvimento. `npm run icons:assistant` gera um sprite com os 24 ícones usados, em um arquivo versionado. As marcas de Google Drive e Confluence usam arquivos oficiais locais;
  origens e licenças em `apps/assistant/ICONS.md`. A rota estática serve também PNG para o logo
  original do Google Drive, mantendo o arquivo sem alteração.

- **Aparência:** `theme.js` aplica Claro, Escuro ou Automático antes de carregar o CSS.
  A preferência usa `localStorage` com fallback quando bloqueado; mudanças do sistema e de
  outras abas atualizam a interface. A paleta cobre navegação, formulários, diálogos, citações
  e estados de erro/sucesso, usando os mesmos tokens de cor.

- **Início simplificado:** a pedido do Pedro, a tela inicial passa a mostrar somente título,
  campo de consulta e uma linha de apoio. Foram retirados o slogan, listas de fontes, sugestões
  e rodapé. Sem documentos, uma única ação abre a biblioteca para começar. A biblioteca e o
  guia continuam acessíveis pela navegação, com retorno de foco apropriado no celular.

- **Identidade e navegação:** a pedido do Pedro, o layout adota a organização familiar de
  aplicativos de conversa: nova conversa e fontes na lateral, histórico discreto, menu recolhível
  também no desktop e seletor de fontes integrado à mensagem. A identidade Nexo usa monograma
  “N” original (`nexo.svg`, também favicon), verde mineral e tipografia do sistema. O topo fica
  livre de divisórias e o campo recebe contornos suaves e controles circulares. Ações e ícones
  funcionais continuam em Lucide. Os tempos internos da busca deixam de aparecer nas respostas.

**Consequências.** A aplicação continua funcionando com `npm run assistente`. Nenhum código
medido no experimento ou dado em `results/` muda. A verificação de UI não valida o modelo
real, dispositivos físicos ou autenticação em contas externas. Comandos e cobertura em
`apps/assistant/README.md`.
