# Protocolo da H3: integração da 4ª fonte

Situação: **executado** em 01/11/2026, passos 1 a 6 (passo 6: `results/runs/2026-11-01-politicas-recuperacao`, `bge-m3` + pgvector, no Mac, junto com a execução final).

**Hipótese (TCC 1).** Maior portabilidade e organização no acesso a fontes heterogêneas com
MCP, comparada a integrações customizadas sem MCP; análise qualitativa do esforço de adaptação
arquitetural.

**Fonte nova.** Políticas internas em HTML (`data/corpus/policies/*.html`, 15 políticas, uma
`<section>` por tópico), com 15 perguntas (`data/questions/policies.json`). O formato HTML não
existe nas outras fontes. O leitor foi retirado do sistema antes do congelamento (ADR 009).

**Natureza do ensaio.** Não é a integração de uma fonte desconhecida. O leitor HTML
(`src/sources/policies.ts`), o caso em `parseSource`, a entrada no catálogo e o conjunto
`policies` já existiam desde o commit do corpus (`e8901fc`); foram **retirados** em `7aa359b`,
antes do congelamento (`1a1337a`), e **reinseridos** nas duas branches da H3. O
`policies.ts` reinserido é o original sem a função `escapeHtml`, que tinha passado para o
gerador do corpus. O autor conhecia o formato, o leitor e o código das duas variantes. O
ensaio mede, portanto, o tamanho e o local das mudanças para **reintegrar** uma fonte
previamente conhecida, não o esforço de integrar uma fonte nova.

## Procedimento

1. Registrar o commit do congelamento (`F`).
2. **Branch `h3-customizada`** (a partir de `F`): integrar as políticas para B e C, sem tocar no
   servidor MCP: leitor HTML em `src/sources/`, caso em `parseSource`, entrada no catálogo
   (título usado no prompt), conjunto `policies` no bench e testes do leitor.
3. **Branch `h3-mcp`** (a partir de `F`): integrar as políticas para D: o mesmo leitor e a
   entrada no catálogo (descrição da tool), `MCP_SOURCES` do servidor e testes. O host
   (`src/approaches/d-mcp-rag.ts`) não pode ser alterado.
4. Em cada branch: `git diff --numstat F..HEAD`, classificando cada arquivo numa camada:
   leitor/fonte, catálogo, host, servidor MCP, bench/configuração, testes, documentação.
   Registrar em `results/runs/<id>/h3.json` (arquivos, linhas + e −, por camada).
5. **Segundo cliente MCP:** com a branch `h3-mcp`, um cliente diferente do host (o inspetor
   oficial `@modelcontextprotocol/inspector` ou um script mínimo com o SDK, sem nenhuma lógica
   do projeto) lista as tools e chama `buscar_policies`. Registrar se funcionou sem alterar o
   servidor e o que foi preciso configurar.
6. Rodar `bench:retrieval --set policies` em B, C e D (Node 22, `bge-m3`), só para confirmar
   que a fonte nova foi integrada e é recuperada; não é medida da H3.

## O que se compara

- Onde as mudanças caem: na integração customizada, o host (B/C) precisa conhecer a fonte; no
  MCP, a mudança fica no servidor e o host é reaproveitado sem alteração.
- Linhas e arquivos alterados por camada (quantitativo, descritivo, sem teste estatístico).
- Reuso por um segundo cliente sem alteração (sim/não, com o que foi necessário).

**Limitação declarada.** O leitor HTML é o mesmo código nas duas branches; a diferença está
em onde ele é ligado. O autor fez as duas integrações, conhecendo o código.

## Resultado (01/11/2026)

Execução: `results/runs/2026-11-01-h3-integracao-politicas` (`h3.json`, os dois patches e
`segundo-cliente.json`). Contagem com `npx tsx scripts/h3-diff.ts 1a1337a <customizada> <mcp>`;
os commits ficaram em branches locais e os patches reproduzem cada integração com
`git checkout 1a1337a && git apply <patch>`.

| Camada | Customizada (B/C) | MCP (D) |
| --- | --- | --- |
| leitor da fonte (`src/sources/policies.ts`, `index.ts`) | 2 arquivos, +25 −3 | 2 arquivos, +25 −3 |
| catálogo das fontes | 1 arquivo, +4 | 1 arquivo, +4 |
| host (`src/approaches`, `src/generation`, `src/retrieval`, `src/api`) | 0 | 0 |
| servidor MCP (`src/mcp/stdio.ts`: fontes expostas por padrão) | 0 | 1 arquivo, +2 −2 |
| configuração do experimento (`sourcesFor('policies')`) | 1 arquivo, +1 −2 | 1 arquivo, +1 −2 |
| testes | 1 arquivo, +13 −4 | 2 arquivos, +24 −4 |
| **total** | **5 arquivos, +43 −9** | **7 arquivos, +56 −11** |

- **Segundo cliente** (`scripts/h3-segundo-cliente.ts`, só o SDK oficial, sem nenhum import de
  `src/`): com a integração MCP, descobriu as 4 tools (`buscar_docs`, `buscar_tickets`,
  `buscar_incidents`, `buscar_policies`) e recebeu trechos de `buscar_policies`, sem nenhuma
  alteração no servidor. Teste funcional com embedder `hash` (sem valor de recuperação).
- **Leitura.** Em linhas, o esforço foi praticamente o mesmo: neste protótipo, a integração
  customizada (B/C) já usa a mesma camada de fontes que o servidor MCP, e C já itera sobre a
  lista de fontes; a variante MCP teve 2 linhas de configuração do servidor e um teste a mais.
  Nenhuma das duas alterou o código do host. A diferença observada é de **reuso**: com MCP, a
  fonte nova ficou disponível para um cliente que não tem nenhum código do projeto; na variante
  customizada, ela só existe para quem importa o código do projeto.
- **Limitações.** O autor fez as duas integrações, conhecendo o código; o leitor é o mesmo nas
  duas; o host de D importa o catálogo das fontes para o rótulo "fonte:" do prompt (acoplamento
  do protótipo, por ser um único repositório); o segundo cliente é um script mínimo, não um
  aplicativo de terceiros. Opcional, no Mac: repetir o passo 5 com o MCP Inspector oficial
  (`npx @modelcontextprotocol/inspector --cli ...`) ou com outro aplicativo cliente.

Depois da medida, a integração MCP (que contém a customizada) foi aplicada na `main`, para o
passo 6 (ADR 010, "Correções depois do congelamento").

## Leitura revisada (01/11/2026, posterior à v3 do artigo)

A revisão do artigo delimitou o que o ensaio demonstra, sem mudar nenhum dado:

- **Demonstrado:** (1) o tamanho e o local das mudanças para reintegrar a fonte em cada variante
  (tabela acima), com o host intocado nas duas; (2) que um segundo cliente MCP, sem código do
  projeto, descobriu e usou a tool da fonte reintegrada; (3) que, para esse segundo cliente,
  nenhuma alteração no servidor foi necessária além das já contadas na variante MCP.
- **Não demonstrado:** superioridade de portabilidade do MCP. O segundo cliente só foi testado
  na variante MCP; não houve ensaio simétrico com um segundo cliente customizado (ex.: outro
  programa que importasse `src/sources` ou chamasse uma API própria), então não há medida de
  quanto custaria o reuso sem MCP.
- **Linhas e arquivos alterados** medem o tamanho da mudança, não tempo, dificuldade ou esforço
  humano, que não foram medidos.
- **Formulação final da H3: inconclusiva.** Quanto ao esforço de adaptação, não há evidência de
  vantagem do MCP: o tamanho das mudanças foi da mesma ordem (+43 −9 contra +56 −11), e linhas
  não medem esforço. Quanto à portabilidade, o reuso por outro cliente sem alterar o servidor
  foi demonstrado só na variante MCP, sem comparação com a alternativa sem MCP. O resultado é
  compatível com a H3, mas não a testa como comparação; "sustentada em parte", usada na v3,
  sugeria uma comparação que não foi feita.

