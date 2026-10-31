# STATUS

Legenda: **planejado** · **implementado** (código existe) · **testado** (testes automatizados passam) · **validado** (usado em experimento registrado em `results/`).

Decisão de 31/10/2026: repositório começa do zero. O protótipo anterior
(`tcc2-prototipo-revisado.zip`) serve só como referência; os resultados do artigo v2
não têm rastreabilidade com este repositório.

| Item | Situação | Observação |
| --- | --- | --- |
| Estrutura de pastas e documentação inicial | implementado | este commit |
| Escolha de stack (banco vetorial, embeddings, LLM, testes) | planejado | a discutir; registrar em `docs/decisoes/` |
| Corpus sintético e perguntas | planejado | |
| Busca textual convencional | planejado | |
| RAG tradicional | planejado | |
| Servidor MCP + abordagem MCP + RAG | planejado | |
| Geração de respostas por LLM | planejado | sem serviço pago sem aprovação |
| Métricas e estatística | planejado | conferir metodologia do TCC 1 |
| Benchmark reproduzível | planejado | |
| API + UI de demonstração | planejado (opcional) | depois do benchmark; fora das métricas |

## Próximos passos
1. Discutir e fechar a arquitetura (`docs/arquitetura.md`).
2. Registrar decisões de stack em ADRs.
3. `package.json`, TypeScript, Vitest e CI mínimo.
