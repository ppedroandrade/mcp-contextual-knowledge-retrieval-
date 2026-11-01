# Artigo: seções 3 (Metodologia) e 4 (Resultados) — rascunho

Situação: a seção 3 descreve o que está **implementado** e o protocolo fixado (ADR 010 e 011);
a seção 4 é só **estrutura**: nenhum número entra aqui antes da execução final no `heldout`.
Cada `[[...]]` é preenchido copiando a tabela de `results/artigo/tabelas-<data>.md` (gerada por
`scripts/tabelas-artigo.ts`) e citando a execução. Números do `dev` ou com embedder `hash` não
entram no artigo. Numeração das seções suposta (3 = Metodologia, 4 = Resultados); ajustar ao
modelo do artigo.

---

## 3. Metodologia

### 3.1 Desenho do experimento

Experimento controlado, em que quatro configurações respondem às mesmas perguntas sobre o mesmo
corpus, na mesma máquina:

| | Configuração | Papel |
| --- | --- | --- |
| A | Busca textual convencional (BM25, índice único) | baseline exigido pela H1 |
| B | RAG tradicional (índice vetorial único, todas as fontes misturadas) | baseline "RAG puro sem MCP" |
| C | Busca vetorial em cada fonte separada + fusão por RRF, **sem** MCP | controle (não previsto no TCC 1) |
| D | MCP + RAG: cada fonte é uma tool de um servidor MCP, descoberta pelo host com `tools/list`; fusão por RRF | proposta |

C e D usam a mesma função de busca; a única diferença é o protocolo. Assim, B × C mede o efeito
da estratégia (busca por fonte) e C × D o do protocolo, e D × A responde à H1.

### 3.2 Corpus e perguntas

Corpus sintético de uma empresa fictícia de SaaS, gerado de forma determinística a partir de um
único "mundo" de fatos, para que as fontes sejam coerentes entre si: wiki técnica (Markdown),
chamados de suporte (JSON), registros de incidentes (CSV + JSON) e, como 4ª fonte da H3,
políticas internas (HTML). [[números finais do corpus: documentos por fonte, unidades de
evidência, fatos — `docs/corpus.md`]]

O gabarito não é anotado à mão: cada pergunta cita fatos do mundo, registrados com a unidade onde
aparecem, e as evidências esperadas derivam desses fatos. Conjuntos: `dev` (60 perguntas, usado
no desenvolvimento) e `heldout` (40 perguntas: 18 de fonte única, 18 multifonte e 4 sem
resposta; 20 literais e 16 parafraseadas), criado **depois** do congelamento da arquitetura
(commit `1a1337a`) e usado só na execução final. A sobreposição lexical entre pergunta e
evidência é de 0,554 nas literais e 0,232 nas parafraseadas (`scripts/lexical-overlap.ts`).

### 3.3 Implementação

Node.js 22 e TypeScript; PostgreSQL 16 com pgvector; embeddings `bge-m3` e gerador
`qwen3:4b-instruct-2507` (quantização Q4_K_M) via Ollama local, temperatura 0, semente fixa;
SDK oficial do MCP em TypeScript, transporte stdio. Cada configuração devolve as 50 unidades
mais bem pontuadas; as métricas usam k = 5, e o gerador recebe os mesmos 5 trechos com um
prompt fixo que exige citação.

### 3.4 Medidas

- **H1 (tempo de recuperação):** latência computacional por pergunta (ms), separando só a
  recuperação (A–D) e a recuperação + geração (B–D), com aquecimento descartado e ordem das
  configurações embaralhada por rodada (ADR 006). O tempo de uma pessoa até achar a resposta não
  é medido (limitação).
- **H2 automática:** R@5, nDCG@5, MRR@5, ER@5 (fração das evidências esperadas no top-5) e
  "completas@5"; nas respostas, uma checagem por regra dos fatos e um juiz por LLM
  (`qwen3.5:4b`, diferente do gerador) com rubrica de correção, completude e sustentação.
- **H2 humana:** a mesma rubrica, de 1 a 5, por ≥ 2 avaliadores cegos à configuração, numa
  planilha (ou na tela de avaliação) com uma linha por resposta distinta; concordância pelo alfa
  de Krippendorff ordinal.
- **H3 (portabilidade):** integração de uma 4ª fonte depois do congelamento, nas variantes
  customizada (B/C) e MCP (D): arquivos e linhas alteradas por camada, e reuso do servidor por um
  segundo cliente MCP sem alteração (`docs/h3-protocolo.md`).

### 3.5 Análise estatística

Como todas as configurações respondem às mesmas perguntas, as observações são pareadas: teste de
Wilcoxon pareado bilateral, correção de Holm dentro de cada medida, IC 95% da diferença por
bootstrap percentil (10 000 reamostragens) e correlação rank-bisserial; o Mann-Whitney U previsto
no TCC 1 é relatado ao lado, com a justificativa da troca; α = 0,05 (ADR 008). Subgrupos literal e
parafraseado como análise secundária. Protocolo e plano fixados antes da execução (ADR 011).

### 3.6 Divergências em relação ao TCC 1

SDK do MCP em TypeScript (e não Python); Wilcoxon pareado como teste principal; juiz por LLM
local no lugar do RAGAS; configuração C acrescentada como controle (`docs/metodologia.md`, seção 3).

---

## 4. Resultados

> Preencher só depois de `scripts/experimento-final.sh`. Cada tabela vem de
> `results/artigo/tabelas-<data>.md`; o texto relata o que a tabela mostra, inclusive resultados
> contrários às hipóteses.

### 4.1 Ambiente da execução

[[máquina, CPU, memória, Node, versões do Ollama e digests dos modelos, modo de energia —
`environment.json` das execuções]]

### 4.2 H1: tempo de recuperação

[[tabela: Recuperação (latência mediana) + testes de latência D × A, D × B, C × B, D × C]]
[[tabela: Geração (recuperação + geração) + testes]]
[[custo do protocolo: D − C e D − tempo da tool, de `scripts/compare-c-d.ts`]]

Critério (ADR 006/011): a H1 é sustentada se a latência de D for **menor** que a de A com p de
Holm < 0,05; caso contrário, é refutada ou não sustentada, e isso é relatado como resultado.

### 4.3 H2: qualidade da recuperação e das respostas

[[tabela: Recuperação (P@5, R@5, MRR@5, nDCG@5, ER@5, completas@5) + testes]]
[[tabela: Qualidade das respostas (regra, rubrica, notas do juiz) + testes; juiz × regra e
repetibilidade do juiz]]
[[tabela: Avaliação humana + alfa de Krippendorff + testes]]
[[subgrupos literal × parafraseada: `estatistica-literal.json` e `estatistica-parafraseada.json`]]

### 4.4 H3: portabilidade e organização

[[tabela: H3 por camada — `results/runs/2026-11-01-h3-integracao-politicas/h3.json`]]
[[segundo cliente MCP — `segundo-cliente.json`]]
[[recuperação no conjunto de políticas (4 fontes), `<data>-politicas-recuperacao`]]
[[leitura e limitações — `docs/h3-protocolo.md`, seção "Resultado"]]

### 4.5 Ameaças à validade

[[corpus sintético; uma máquina; modelos pequenos e quantizados; o autor fez as duas integrações
da H3; tamanho do heldout (40); concordância entre avaliadores; tempo de pessoa não medido]]
