# Ícones do Nexo

## Interface

Os ícones de navegação, ações e arquivos vêm de **Lucide** (`lucide-static`,
versão fixada em `package.json`). `icons.svg` contém somente os ícones utilizados.
A licença ISC e a atribuição MIT dos ícones derivados de Feather estão incluídas no SVG.

- Documentação: https://lucide.dev/guide/static
- Regeneração local: `npm run icons:assistant`
- Fonte do gerador: `scripts/assistant-icons.ts`

O sprite gerado é versionado. O navegador não carrega JavaScript da
biblioteca nem depende de CDN; a aplicação continua sem etapa de build obrigatória.

## Identidade Nexo

`nexo.svg` é o monograma original “N” da interface, usado na marca, nas respostas e como
favicon. É um vetor local, com a cor herdada da paleta verde mineral no aplicativo.
Não é um ícone da biblioteca Lucide nem o logo do ChatGPT.

## Marcas das integrações

As marcas são arquivos oficiais, preservados e servidos localmente. São utilizadas
somente para identificar as respectivas integrações, acompanhadas do nome do produto.

- **Google Drive:** `google-drive.png`, ícone oficial de produto em 128 × 128 px.
  - Orientações: https://developers.google.com/workspace/drive/api/guides/branding
  - Arquivo: https://www.gstatic.com/images/branding/productlogos/drive_2026/v2/web-64dp/logo_drive_2026_color_2x_web_64dp.png
- **Confluence:** `confluence.svg`, `Confluence_icon.svg` do pacote oficial de logos.
  - Orientações: https://atlassian.design/foundations/logos
  - Pacote: https://atlassian.design/assets/4a72207a2517/logos/confluence_app.zip

Google Drive é uma marca do Google. Confluence é uma marca da Atlassian.
As marcas permanecem sujeitas às condições de uso de seus respectivos proprietários.
