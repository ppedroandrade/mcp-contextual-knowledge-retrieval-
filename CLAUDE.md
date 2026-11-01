# CLAUDE.md — instruções para o Claude Code neste repositório

## O que é este projeto

Software do TCC 2 de Pedro Henrique de Andrade Salvaro (Engenharia de Software). Compara
abordagens de recuperação de conhecimento corporativo sobre o **mesmo corpus sintético**
e as **mesmas perguntas**:

| | Configuração | Código |
| --- | --- | --- |
| A | Busca textual convencional (BM25) | `src/approaches/a-bm25.ts` |
| B | RAG tradicional (índice vetorial único) | `src/approaches/b-rag.ts` |
| C | Controle: busca vetorial por fonte + RRF, **sem** MCP | `src/approaches/c-per-source.ts` |
| D | MCP + RAG: host descobre as tools do servidor MCP e funde por RRF | `src/approaches/d-mcp-rag.ts`, `src/mcp/` |

C e D usam a mesma função de busca (`searchSource`); a única diferença é o protocolo.
B × C mede a estratégia; C × D mede o protocolo; A é o baseline. Ver `docs/decisoes/005`.

Leia antes de mudar qualquer coisa: `STATUS.md`, `docs/arquitetura.md`,
`docs/metodologia.md` (hipóteses do TCC 1 e divergências), `docs/corpus.md` e
`docs/decisoes/`.

## Regras do projeto (não negociáveis)

- **Node.js 22 + TypeScript.** Não migrar nada para Python. Python só como script
  auxiliar de conferência, se for o caso.
- **Sem serviços pagos** sem aprovação explícita do Pedro. Embeddings e LLM via Ollama local.
- **Nunca inventar resultados, métricas, execuções, citações ou significância
  estatística.** Todo número citado precisa vir de uma execução gravada em
  `results/runs/<id>/` com `environment.json`.
- Distinguir sempre **planejado**, **implementado**, **testado** e **validado**, e manter
  o `STATUS.md` atualizado a cada entrega.
- Números obtidos com `--embedder hash` **não têm valor experimental** (embedding não
  semântico, só para testes).
- O conjunto de perguntas `heldout` só pode ser criado **depois** de congelar a
  arquitetura (registrar o commit do congelamento). Não ajustar parâmetros depois.
  Congelado em `1a1337a` (ADR 010); o `heldout` já existe. Correções depois disso só com
  registro no ADR 010.
- Toda decisão de arquitetura nova vira um ADR curto em `docs/decisoes/`.
- Mudanças em `src/corpus/` exigem `npm run corpus` e versionar `data/` (há um teste que
  falha se `data/` estiver desatualizado).

## Comandos

```bash
npm install
npm run check              # typecheck + testes unitários (o mesmo que o CI)
npm run corpus             # regenera data/ a partir do gerador (determinístico)

docker compose up -d                           # tudo: PostgreSQL + pgvector, Ollama, modelos e o Nexo (ADR 015)
docker compose up -d postgres ollama           # só o que as medições do TCC usam (o Nexo não pode rodar junto)
docker compose exec ollama ollama pull bge-m3  # modelo de embeddings (ADR 003)
docker compose exec ollama ollama pull qwen3:4b-instruct-2507-q4_K_M  # LLM (ADR 003)
npm run test:integration                       # pgvector × busca exata em memória
npm run ingest                                 # indexa docs, chamados e incidentes
npm run bench:retrieval -- --approaches A,B,C,D --rounds 5 --out <id>
npm run bench:generation -- --approaches B,C,D --rounds 3 --out <id>
npm run mcp:server                             # servidor MCP via stdio
npm run demo                                   # API + UI de demonstração em http://127.0.0.1:3000 (fora das métricas)
npm run demo -- --avaliacao <planilha>         # avaliação humana cega na UI (só Node); notas em avaliacoes-ui/
npm run assistente -- --exemplo                # assistente da empresa em http://127.0.0.1:3100 (fora das métricas, ADR 012)
npx tsx scripts/compare-c-d.ts <id>            # confere C = D e D − C numa execução
npx tsx scripts/recalculo-mediana.ts            # latência com a mediana usual (ADR 016), em results/recalculos/, sem regravar results/runs/
npm run stats -- --run <id> [--style parafraseada]  # Wilcoxon + Holm + bootstrap (e Mann-Whitney) numa execução, inclusive a planilha com notas humanas (ADR 008)
npm run eval:answers -- --run <geração> --out <id>   # regra dos fatos + juiz (ADR 007)
npm run eval:human -- --run <geração> --out <id>     # planilha cega; --import <id> --ratings a.csv,b.csv
scripts/experimento-final.sh                         # experimento final no Mac (ADR 011; docs/experimento-final.md); MODO=teste para ensaiar
npx tsx scripts/tabelas-artigo.ts --recuperacao <id> ...  # tabelas do artigo, só a partir de results/runs/
```

`bench:retrieval` aceita `--set dev|heldout|policies`, `--embedder ollama|hash`,
`--store pg|memory`. Para `--set policies` (4ª fonte, integrada na H3), indexe antes com
`npm run ingest -- --sources docs,tickets,incidents,policies`. As medições exigem Node 22
(`.nvmrc`; `nvm use`). `bench:generation` aceita
os mesmos e `--llm ollama|simulated`, `--model`; recusa a abordagem A.

Medições longas: Mac na tomada, tampa aberta, árvore do git limpa e sem trocar de branch
durante a execução. Ao trocar de LLM, `docker compose exec ollama ollama stop <modelo>` e
esperar `/api/ps` vazio antes (a VM do Docker tem 7,7 GiB). O juiz (`JUDGE_MODEL`) nunca
deve ser o gerador; a planilha cega não pode revelar a abordagem (C e D numa linha só).

## Convenções

- Commits e PRs em português. Uma branch e um PR por etapa; CI verde antes do merge.
- Testes unitários em `test/unit` (rodam no CI, sem serviços externos); testes que
  precisam de banco ou Ollama em `test/integration`.
- Mensagens de erro e documentação em português.

## Assistente da empresa (fora do experimento)

`src/assistant/` e `apps/assistant/` são um protótipo de produto (ADR 012, `docs/assistente.md`).
Podem evoluir livremente, mas **não podem alterar o código medido no TCC** (`src/approaches`,
`src/mcp`, `src/generation`, `src/evaluation`, `src/bench`, `src/indexing`, `src/retrieval`,
`src/sources`, `src/corpus`): só importar dele. O estado local fica em `.assistente/` (fora do
git; tem a chave que cifra os tokens dos conectores).
