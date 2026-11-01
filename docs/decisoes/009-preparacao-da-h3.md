# 009 — Preparação da H3, tempo da tool em D e versão do Node

Data: 01/11/2026 · Situação: aceita

**Contexto.** A H3 compara o esforço de integrar uma fonte nova numa integração customizada
(B/C) e via MCP (D) (`docs/metodologia.md`, seção 2). As políticas internas (HTML) foram
geradas junto com o corpus, e o leitor delas, a entrada no catálogo e o conjunto `policies`
do bench já estavam no código desde o commit do corpus. Integrar a 4ª fonte depois do
congelamento daria um diff quase vazio nos dois lados, e a H3 não mediria nada. A auditoria
de 01/11/2026 também pediu, antes do experimento final, o tempo da tool dentro de D (ADR 004)
e uma versão única do Node nas medições.

**Decisão.**
1. **Retirar do sistema a integração das políticas, antes do congelamento:** o leitor HTML
   (`src/sources/policies.ts`), o caso `policies` de `parseSource`, a entrada `policies` de
   `SOURCE_CATALOG` e o conjunto `policies` de `sourcesFor`. Ficam o gerador (`src/corpus/`),
   os dados (`data/corpus/policies/*.html`), as 15 perguntas (`data/questions/policies.json`)
   e o tipo `SourceName`, que é o vocabulário do corpus. A rastreabilidade dos fatos das
   políticas é conferida no HTML gerado, nos testes do corpus. O artigo declara que o código
   foi retirado antes, para poder medir.
2. **Protocolo da H3** (`docs/h3-protocolo.md`): depois do congelamento, integrar as políticas
   em duas branches a partir do commit congelado, uma para B/C e outra para D, e contar o
   `git diff --numstat` por camada (fonte/leitor, host, servidor MCP, bench, testes); depois,
   testar se um segundo cliente MCP usa a tool nova sem nenhuma alteração.
3. **Tempo da tool em D:** cada tool do servidor mede o `searchSource` com `performance.now()`
   e devolve `tempoMs` junto com os resultados. O host guarda os tempos da última chamada e o
   bench grava, só para D, o maior tempo entre as tools chamadas em paralelo (`toolMs`, por
   rodada). Latência de D − `toolMs` aproxima o custo do protocolo (serialização, IPC e
   espera); `scripts/compare-c-d.ts` imprime essa diferença.
4. **Node 22 nas medições:** `.nvmrc` com 22, `engines` `^22.12.0`, o CI lê o `.nvmrc`, e
   `bench:retrieval` e `bench:generation` recusam outra versão principal
   (`TCC_ALLOW_ANY_NODE=1` libera, só para testes). `environment.json` grava `nodeFixado`.

**Consequências.**
- As rodadas dev registradas (Node 26.13, sem `toolMs`) continuam válidas como verificação,
  mas não se misturam com as do experimento final.
- `npm run ingest -- --sources ...,policies` e `--set policies` falham até a integração.
- O `tempoMs` acrescenta um número ao JSON de cada resposta da tool; o efeito no tamanho da
  mensagem é desprezível perto dos trechos devolvidos.
- No Mac do Pedro é preciso instalar o Node 22 (ex.: `nvm install 22`) antes das medições.
