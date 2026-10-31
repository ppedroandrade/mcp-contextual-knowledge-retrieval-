# TCC 2 — MCP + RAG para recuperação de conhecimento corporativo

Software do Trabalho de Conclusão de Curso 2 de Pedro Henrique de Andrade Salvaro.
Compara três abordagens sobre o mesmo corpus sintético e as mesmas perguntas:

1. **Busca textual convencional** (baseline)
2. **RAG tradicional** (recuperação semântica + geração, sem MCP)
3. **MCP + RAG** (fontes expostas por um servidor Model Context Protocol)

Stack: Node.js 22 + TypeScript. Status atual em [STATUS.md](STATUS.md);
arquitetura em [docs/arquitetura.md](docs/arquitetura.md).

> Em construção: estrutura inicial. Instruções de instalação e execução serão
> adicionadas conforme cada módulo for implementado.

## Estrutura

```
docs/        arquitetura, protocolo experimental, decisões (ADRs)
data/        corpus sintético e perguntas de avaliação
src/
  core/        tipos, configuração, texto
  corpus/      gerador do corpus sintético
  sources/     leitura e segmentação das fontes
  indexing/    índices lexical e vetorial
  retrieval/   busca semântica e fusão
  approaches/  as três abordagens (mesma interface)
  mcp/         servidor e cliente MCP
  generation/  geração de respostas por LLM
  evaluation/  métricas e estatística
  bench/       execução dos experimentos
test/        unit/ e integration/
scripts/     utilitários
results/     resultados de execuções reais
```
