# MCP Contextual Knowledge Retrieval — TCC 2: MCP + RAG para recuperação de conhecimento corporativo

Software do Trabalho de Conclusão de Curso 2 de Pedro Henrique de Andrade Salvaro.
Compara as abordagens sobre o mesmo corpus sintético e as mesmas perguntas:

- **A. Busca textual convencional** (baseline, BM25)
- **B. RAG tradicional** (índice vetorial único + geração, sem MCP)
- **C. Controle**: busca vetorial por fonte + fusão, sem MCP
- **D. MCP + RAG** (fontes expostas por um servidor Model Context Protocol)

C existe para separar o efeito do protocolo (C × D) do efeito da estratégia de busca (B × C).

Stack: Node.js 22 + TypeScript. Status atual em [STATUS.md](STATUS.md);
arquitetura em [docs/arquitetura.md](docs/arquitetura.md).

> Em construção. Só o ferramental e os tipos básicos existem; as abordagens ainda
> não foram implementadas.

## Requisitos

- Node.js 22.12 ou superior
- Docker (PostgreSQL 16 + pgvector e Ollama, pelo `docker-compose.yml`)

## Como rodar

```bash
npm install
cp .env.example .env
npm run check            # typecheck + testes unitários (o mesmo que o CI roda)
npm run corpus           # regenera data/corpus e data/questions (já versionados)
docker compose up -d     # banco vetorial e Ollama, necessários a partir da indexação
```

Decisões de stack em [docs/decisoes/](docs/decisoes/).

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
  api/         API HTTP fina para a demo (opcional)
apps/demo/   UI de demonstração (opcional, depois do benchmark)
test/        unit/ e integration/
scripts/     utilitários
results/     resultados de execuções reais
```
