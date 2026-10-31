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
