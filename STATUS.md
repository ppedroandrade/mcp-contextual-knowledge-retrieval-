# STATUS

Legenda: **planejado** · **implementado** (código existe) · **testado** (testes automatizados passam) · **validado** (usado em experimento registrado em `results/`).

Decisão de 31/10/2026: repositório começa do zero. O protótipo anterior
(`tcc2-prototipo-revisado.zip`) serve só como referência; os resultados do artigo v2
não têm rastreabilidade com este repositório.

| Item | Situação | Observação |
| --- | --- | --- |
| Estrutura de pastas e documentação inicial | implementado | |
| Ferramental: TypeScript, Vitest, CI, docker-compose | implementado, testado | `npm run check` passa (3 testes unitários de configuração) |
| Tipos compartilhados e interface `Retriever` | implementado | `src/core/types.ts` |
| Escolha de stack | decidido | ADRs 001 a 005 em `docs/decisoes/`; modelo do LLM a fixar |
| Mapeamento TCC 1 → métricas | documentado | `docs/metodologia.md`; divergências listadas |
| Corpus sintético e perguntas | planejado | proposta em `docs/corpus.md` |
| Busca textual convencional | planejado | |
| RAG tradicional | planejado | |
| Configuração C (busca por fonte sem MCP) | planejado | controle do protocolo, ADR 005 |
| Servidor MCP + abordagem MCP + RAG | planejado | |
| Geração de respostas por LLM | planejado | sem serviço pago sem aprovação |
| Métricas e estatística | planejado | conferir metodologia do TCC 1 |
| Benchmark reproduzível | planejado | |
| API + UI de demonstração | planejado (opcional) | depois do benchmark; fora das métricas |

## Próximos passos
1. Validar com o orientador as divergências da seção 3 de `docs/metodologia.md`.
2. Implementar o gerador do corpus (`src/corpus`) e a leitura das fontes (`src/sources`).
