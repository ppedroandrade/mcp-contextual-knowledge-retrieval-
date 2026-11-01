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

> Em construção: as quatro abordagens, o servidor MCP, a geração e a avaliação das
> respostas e a estatística existem. O que está pronto e testado está no
> [STATUS.md](STATUS.md).

## Requisitos

- Node.js 22 (`.nvmrc`; as medições recusam outra versão principal, ADR 009)
- Docker (PostgreSQL 16 + pgvector e Ollama, pelo `docker-compose.yml`)

## Tudo de uma vez (Docker)

```bash
docker compose up -d              # banco + Ollama + modelos (1ª vez, ~3,7 GB) + Nexo
open http://127.0.0.1:3100        # o assistente da empresa
docker compose logs -f assistente # acompanhar o Nexo
docker compose down               # parar tudo (dados e modelos ficam nos volumes)
```

Para as medições do TCC, suba só o banco e o Ollama (`docker compose up -d postgres ollama`)
ou pare o Nexo (`docker compose stop assistente`): ele não pode usar o mesmo Ollama durante uma
medição (ADR 015).

## Como rodar

```bash
npm install
cp .env.example .env
npm run check            # typecheck + testes unitários (o mesmo que o CI roda)
npm run corpus           # regenera data/corpus e data/questions (já versionados)
npm run bench:retrieval  # só a busca textual (A), sem serviços externos

# com Docker: banco vetorial, modelo de embeddings e LLM
docker compose up -d
docker compose exec ollama ollama pull bge-m3
docker compose exec ollama ollama pull qwen3:4b-instruct-2507-q4_K_M
npm run test:integration                       # pgvector contra a busca exata em memória
npm run ingest                                 # indexa docs, chamados e incidentes no pgvector
npm run bench:retrieval -- --approaches A,B,C,D  # métricas e latência no conjunto dev
npm run bench:generation -- --approaches B,C,D   # recuperação + geração (A não gera resposta)
docker compose exec ollama ollama pull qwen3.5:4b  # juiz da avaliação (ADR 007)
npm run eval:answers -- --run <execução da geração> --out <id>  # regra dos fatos + juiz
npm run eval:human -- --run <execução da geração> --out <id>    # planilha cega para avaliadores
npm run eval:human -- --import <id> --ratings a.csv,b.csv       # importa as notas humanas
npm run mcp:server                             # servidor MCP via stdio (para Inspector ou outro host)

# sem Docker (só para conferir o pipeline; embedding NÃO semântico, LLM simulado):
npm run bench:retrieval -- --approaches A,B,C,D --embedder hash --store memory
npm run bench:generation -- --embedder hash --store memory --llm simulated
docker compose up -d     # banco vetorial e Ollama, necessários a partir da indexação
```

Decisões de stack em [docs/decisoes/](docs/decisoes/).

## Assistente da empresa (fora do experimento)

Protótipo de produto sobre a mesma arquitetura (configuração D), com a interface **Nexo**:
início com consulta central, biblioteca de fontes e guia rápido acessíveis pela navegação. As fontes da empresa
(upload de PDF, Word, Markdown; Google Drive/Docs; Confluence) são expostas como tools de um
servidor MCP, também disponível em `/mcp` para outros clientes. Não entra nas métricas
(ADRs 012 e 013). Testes de interface e comandos em [apps/assistant/README.md](apps/assistant/README.md).

```bash
npm run assistente -- --exemplo   # http://127.0.0.1:3100, com a wiki de exemplo
```

Como o contexto funciona e como conectar o Google Drive e o Confluence:
[docs/assistente.md](docs/assistente.md).

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
  approaches/  as quatro abordagens (mesma interface)
  mcp/         servidor e cliente MCP
  generation/  geração de respostas por LLM
  evaluation/  métricas e estatística
  bench/       execução dos experimentos
  api/         API HTTP fina para a demo (opcional)
  assistant/   assistente da empresa: conectores, ingestão, servidor MCP e chat (ADR 012)
apps/demo/   UI de demonstração (opcional, depois do benchmark)
apps/assistant/  UI do assistente da empresa
test/        unit/ e integration/
scripts/     utilitários
results/     resultados de execuções reais
```

Medições de latência: computador na tomada e com a tampa aberta (o `environment.json` de
cada execução grava a fonte de energia). Ao trocar de LLM no Ollama, descarregue o anterior
com `docker compose exec ollama ollama stop <modelo>` e espere `curl localhost:11434/api/ps`
voltar vazio: a VM do Docker tem pouca memória (ADR 003 e 007).
