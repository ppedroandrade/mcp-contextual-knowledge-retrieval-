# 005 — Configurações comparadas

Data: 31/10/2026 · Situação: aceita (confirmar nomes e hipóteses no texto do TCC 1)

**Contexto.** Na versão anterior, MCP + RAG mudava ao mesmo tempo o protocolo e a
estratégia de busca (uma busca por fonte + fusão, contra um índice único). O ganho foi
atribuído ao MCP, mas vinha da estratégia.

**Decisão.** Quatro configurações, todas com a interface `Retriever`:

| | Configuração | Recuperação | MCP |
| --- | --- | --- | --- |
| A | Busca textual convencional | BM25 sobre todas as fontes | não |
| B | RAG tradicional | vetorial, índice único | não |
| C | Controle | vetorial, busca por fonte + fusão | não |
| D | MCP + RAG | vetorial, busca por fonte (tools MCP) + fusão | sim |

C e D usam a mesma função de busca e fusão; a única diferença é o protocolo.
B × C mede a estratégia; C × D mede o protocolo; A é o baseline.

**Consequências.** A e as métricas de geração: se a metodologia do TCC 1 prevê que a
busca textual não gera resposta, A entra só nas métricas de recuperação.

**Detalhes de implementação (31/10/2026).**
- C e D chamam a mesma função `searchSource` (`src/approaches/c-per-source.ts`). Cada
  chamada por fonte calcula o embedding da pergunta de novo, porque no MCP a tool recebe
  texto. Assim C reproduz o custo de D sem o protocolo, e a diferença B × C inclui esse
  custo extra da estratégia.
- Cada fonte devolve até k unidades; a fusão é RRF com c = 60, sem pesos, com desempate
  pela similaridade original e depois pelo id.
