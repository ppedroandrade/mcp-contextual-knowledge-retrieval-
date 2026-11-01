# Protocolo da H3: integração da 4ª fonte

Situação: **planejado** (executar depois do congelamento; ADR 009).

**Hipótese (TCC 1).** Maior portabilidade e organização no acesso a fontes heterogêneas com
MCP, comparada a integrações customizadas sem MCP; análise qualitativa do esforço de adaptação
arquitetural.

**Fonte nova.** Políticas internas em HTML (`data/corpus/policies/*.html`, 15 políticas, uma
`<section>` por tópico), com 15 perguntas (`data/questions/policies.json`). O formato HTML não
existe nas outras fontes. O leitor foi retirado do sistema antes do congelamento (ADR 009).

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
