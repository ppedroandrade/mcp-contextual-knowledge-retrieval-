# Artigo: seções 3 (Metodologia) e 4 (Resultados) — rascunho

Situação: a seção 3 descreve o que está **implementado** e o protocolo fixado (ADR 010 e 011).
A seção 4 (4.1 a 4.4) está **redigida** com os números da execução final de 01/11/2026 e da
avaliação humana por consenso (`results/artigo/tabelas-2026-11-01.md`); falta a 4.5 (ameaças).
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
- **H2 humana:** a mesma rubrica, de 1 a 5, na tela de avaliação cega (sem pista da
  configuração), com uma linha por resposta distinta. O protocolo previa ≥ 2 avaliadores
  independentes e o alfa de Krippendorff ordinal; na execução, os dois avaliadores deram notas de
  consenso (desvio registrado no ADR 011), e a concordância foi medida entre o consenso humano e
  o juiz automático.
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

A execução final ocorreu em 01/11/2026, numa única sessão de 1 h 21 min, num MacBook com Apple
M4 Pro (12 núcleos) e 24 GB de memória, ligado à tomada (modo de energia automático), com
Node.js 22.23.4 e o código no commit `2042154`, com a árvore do git limpa. O PostgreSQL com
pgvector e o Ollama 0.40.13 rodaram em contêineres Docker; nesse arranjo, os modelos rodam na CPU
da máquina virtual do Docker, sem a GPU do Mac (`sizeVram` = 0 nos registros), o que vale para as
quatro configurações e afeta os valores absolutos de latência, não a comparação. Modelos (digests
em `environment.json`): `bge-m3` (embeddings), `qwen3:4b-instruct-2507-q4_K_M` (gerador, temperatura
0, semente 42) e `qwen3.5:4b` (juiz). O protocolo do ADR 011 foi seguido sem desvios: todas as
etapas passaram na primeira tentativa.

Fontes: `results/runs/2026-11-01-heldout-recuperacao`, `-heldout-geracao`, `-heldout-avaliacao`,
`-heldout-planilha-cega` e `2026-11-01-politicas-recuperacao`.

### 4.2 H1: tempo de recuperação

Critério fixado antes da execução (ADR 006 e 011): a H1 é sustentada se a latência de D for
**menor** que a de A, com p de Holm < 0,05.

[[Tabela X: latência mediana da recuperação por configuração e testes de latência — copiar de
`results/artigo/tabelas-2026-11-01.md`, seção "Recuperação" e seus testes]]

**A H1 foi refutada.** Na recuperação, a mediana por pergunta foi de 0,3 ms na busca textual (A)
e de 113 ms em MCP + RAG (D). D foi mais lento que A em todas as 40 perguntas: diferença mediana
de +112,6 ms (IC 95% [102,5; 122,8]), Wilcoxon pareado com p de Holm < 0,001 e correlação
rank-bisserial r = 1,00; o Mann-Whitney U previsto no TCC 1 leva à mesma conclusão (p de Holm
< 0,001). O resultado se repetiu nos dois subgrupos (literal: +110,9 ms; parafraseada:
+119,9 ms; ambos p de Holm < 0,001) e no conjunto de políticas (+109,7 ms, p de Holm < 0,001).

A decomposição mostra de onde vem a diferença. B, que já usa embeddings mas consulta um índice
único, teve mediana de 36,3 ms; as duas configurações que buscam em cada fonte separada ficaram
acima de B (D × B +73,7 ms, IC 95% [66,8; 90,1]; C × B +72,6 ms, IC 95% [66,6; 82,3]; ambos p de
Holm < 0,001) e no mesmo patamar entre si: D × C deu +1,8 ms (IC 95% [−5,5; 6,8]; p de Holm =
0,656). O custo adicional vem, portanto, da estratégia, e não do protocolo. A explicação
mais provável, pelo código (não medida em separado), é que em C e D cada
fonte calcula o embedding da pergunta e faz a sua busca (`searchSource`; em D, cada tool é
independente e precisa fazer isso sozinha), o que triplica as chamadas ao modelo de embeddings
em relação a B. Quanto ao protocolo, a mediana de D
menos o tempo gasto dentro da tool foi de 1,64 ms por pergunta (`scripts/compare-c-d.ts`). A busca
textual em memória, sem modelo, é duas ordens de grandeza mais rápida que qualquer configuração
semântica.

[[Tabela Y: latência da recuperação + geração — copiar de "Geração" e seus testes]]

Com a geração, a latência total ficou em torno de 5,5 a 5,8 s por pergunta (mediana: B 5525 ms,
C 5753 ms, D 5689 ms) e é dominada pelo LLM. Nenhuma comparação foi significativa: D × B
+88,1 ms (IC 95% [−78,0; 494,6]; p de Holm = 0,394) e D × C −56,2 ms (IC 95% [−101,9; 12,7];
p de Holm = 0,144). Não há D × A nessa medida, porque A não gera resposta. A diferença de
~70 ms da recuperação representa pouco mais de 1% do tempo total e se perde na variação da
geração.

Leitura: a H1, como formulada no TCC 1 (redução do tempo de recuperação com MCP + RAG em relação
à busca textual), não se sustenta quando o tempo é medido como latência do sistema. A medida
não captura o tempo de uma pessoa até chegar à resposta (ADR 006), que fica como limitação e
trabalho futuro.

### 4.3 H2: qualidade da recuperação e das respostas

Critério (ADR 011): a H2 é sustentada se D for melhor que as linhas de base nas medidas de
qualidade, com p de Holm < 0,05. Na recuperação, a comparação com a busca textual é D × A; nas
respostas, A não gera texto, e as comparações são D × B, C × B e D × C.

**Recuperação.** [[Tabela W: copiar "Recuperação (k = 5)" e seus testes]] Nas 36 perguntas com
resposta, as quatro configurações ficaram próximas: R@5 de 0,750 (A), 0,681 (B) e 0,736 (C = D);
nDCG@5 de 0,729, 0,667 e 0,698; ER@5 de 0,472, 0,514 e 0,486. Nenhuma diferença foi
significativa (D × A: R@5 −0,014, p de Holm = 0,748; nDCG@5 −0,031, p = 0,886; MRR@5 −0,119,
IC 95% [−0,251; 0,006], p = 0,192). A busca textual, portanto, não perdeu para as configurações
semânticas neste corpus.

**Respostas, avaliação automática.** [[Tabela V: copiar "Qualidade das respostas (automática)" e
seus testes]] O acerto pela regra dos fatos foi de 47,5% em B e 55,0% em C = D; o acerto pela
rubrica do juiz (correção ≥ 4), de 62,5% e 57,5%; as notas médias do juiz, de 3,50 e 3,38
(correção), 3,38 e 3,30 (completude) e 4,95 e 4,85 (sustentação). Nenhuma diferença foi
significativa (menor p de Holm: 0,359, no acerto pela regra, D × B +0,075, IC 95% [−0,025;
0,200]). O juiz concordou com a regra dos fatos em 84,1% dos itens (κ = 0,46) e repetiu as mesmas
notas nas duas repetições em 100% dos itens.

**Respostas, avaliação humana.** [[Tabela U: copiar "Avaliação humana (cega)", a comparação com
o juiz e os testes]] As 79 respostas distintas foram avaliadas às cegas por dois avaliadores que
trabalham com o autor. Eles avaliaram **em conjunto e chegaram a uma nota de consenso** para cada
item, em vez de avaliar de forma independente, como previa o ADR 011 (desvio registrado lá). Por
isso não há concordância entre avaliadores para relatar: a análise usa uma única planilha de
notas. As médias foram de 3,33 (B) e 3,38 (C = D) em correção, 3,25 e 3,33 em completude e 5,00 e
4,90 em sustentação, sem nenhuma diferença significativa (correção D × B +0,050, IC 95% [−0,300;
0,400], p de Holm = 1,000; sustentação −0,100, IC 95% [−0,250; 0,000], p = 0,315).

No lugar da concordância entre avaliadores, comparou-se o consenso humano com o juiz automático,
item a item (`scripts/humano-x-juiz.ts`). Em todos os 79 itens, o alfa de Krippendorff ordinal
foi de 0,91 (correção), 0,92 (completude) e 0,80 (sustentação). Esse valor inclui as notas que a
rubrica fixa por regra (como o "não sei"), que favorecem a concordância. Nos 44 itens em que o
juiz deu nota de fato, o alfa cai para 0,58 (correção), 0,65 (completude) e 0,79 (sustentação),
e o juiz foi, em média, mais generoso que os humanos (humano − juiz: −0,30 na correção e −0,23 na
completude). Pelo limiar usual de 0,667, a concordância do juiz com os humanos é aceitável só na
sustentação; em correção e completude, o juiz não substitui a avaliação humana, o que reforça a
decisão de não usá-lo sozinho (ADR 007).

**Comentário dos avaliadores** (registrado pelo autor): as respostas "quase não inventam
informações e se apoiam muito bem nos trechos"; o principal problema é responder "não sei"
quando a referência tem a resposta, "provavelmente por falhas na recuperação dos documentos", e,
em alguns casos, associar incidentes e causas incorretamente. Os registros da geração confirmam
a primeira parte: nas perguntas com resposta, nenhuma configuração disse "não sei" quando todas as
evidências esperadas estavam entre os 5 trechos do prompt, e todas disseram em 67% a 70% das vezes
quando faltava alguma (`2026-11-01-heldout-geracao/summary.json`). Ou seja, a abstenção indevida
vem da recuperação, não do gerador.

**Literal × parafraseada (análise secundária).** Na avaliação humana, a diferença entre os estilos
é muito maior que entre as configurações: correção média de 4,10 a 4,15 nas perguntas literais e
de 1,88 a 2,06 nas parafraseadas, nas três configurações (comparação descritiva; os subgrupos têm
perguntas diferentes e não foram testados entre si). Nenhum par de configurações foi
significativo dentro de cada subgrupo.

Leitura: **a H2 não foi sustentada.** Nem as métricas automáticas nem a avaliação humana mostraram
diferença significativa a favor de MCP + RAG, seja contra o RAG tradicional, seja (na recuperação)
contra a busca textual. As três configurações que geram resposta têm qualidade semelhante, e o
fator que mais pesa é a recuperação do trecho certo, sobretudo quando a pergunta não usa os
termos do documento.

> Nota para a redação dos subgrupos (conferida em 01/11/2026). A análise por estilo estava
> prevista no ADR 011 como **secundária**, "sem correção adicional entre os subgrupos". O único
> resultado de qualidade significativo, nDCG@5 D × A no subgrupo literal (+0,119, IC 95%
> [0,050; 0,196], n = 20), tem p de Holm = 0,032, corrigido só entre os pares da mesma medida
> (3 pares válidos; D × C é idêntico e fica de fora), e não entre as seis medidas nem entre os
> dois subgrupos. O Mann-Whitney não acompanha (p de Holm = 0,133), o total não é significativo
> (−0,031, p de Holm = 0,887) e, no subgrupo parafraseado, a direção se inverte (−0,219, IC 95%
> [−0,442; −0,008], p de Holm = 0,290). Relatar como achado secundário e frágil, que não muda a
> conclusão da H2 automática, e não como confirmação.

### 4.4 H3: portabilidade e organização

A 4ª fonte (políticas internas, em HTML) foi integrada depois do congelamento, a partir do
mesmo commit (`1a1337a`), de duas formas: customizada, para B e C, e via servidor MCP, para D.

[[Tabela Z: esforço por camada — copiar de `results/artigo/tabelas-2026-11-01.md`, seção "H3"]]

Em linhas de código, o esforço foi praticamente o mesmo: 5 arquivos (+43 −9) na integração
customizada e 7 arquivos (+56 −11) na integração MCP. As duas compartilham o leitor da nova fonte
(2 arquivos, +25 −3), a entrada no catálogo de fontes e a configuração do experimento. A variante
MCP exigiu, além disso, 2 linhas no servidor (expor a nova fonte por padrão) e um teste da
descoberta da nova tool. **Nenhuma das duas alterou o código do host** (abordagens, geração,
recuperação e API).

A diferença está no reuso. Um segundo cliente MCP, um script que usa só o SDK oficial e nenhum
código do projeto, descobriu as quatro tools (`buscar_docs`, `buscar_tickets`,
`buscar_incidents` e `buscar_policies`) e recebeu trechos da nova fonte sem nenhuma alteração no
servidor. Na variante customizada, a fonte nova só fica disponível para quem importa o código
do projeto.

Na recuperação sobre as quatro fontes (15 perguntas sobre políticas, 5 rodadas), a integração
funcionou nas quatro configurações. As medidas ficaram próximas do teto: R@5 = 1,000 em todas;
nDCG@5 de 0,975 (A), 0,974 (B) e 0,995 (C = D). Nenhuma diferença de qualidade foi
significativa, e a latência repetiu o padrão da H1 (D × A +109,7 ms, p de Holm < 0,001). C e D
devolveram o mesmo top-5 nas 15 perguntas.

Leitura: os dados sustentam a parte de **portabilidade** da H3 (a fonte integrada via MCP ficou
disponível a outro cliente sem nenhum trabalho adicional), mas não uma vantagem de **esforço de
integração**, que foi equivalente. Limitações: o autor fez as duas integrações conhecendo o
código; o leitor da fonte é o mesmo nas duas; o host de D importa o catálogo de fontes para
rotular os trechos no prompt (acoplamento do protótipo, por ser um único repositório); o
segundo cliente é um script mínimo, não um aplicativo de terceiros; e o conjunto de políticas
é pequeno e fácil (efeito teto). Detalhes em `docs/h3-protocolo.md`.

### 4.5 Ameaças à validade

- **Validade externa.** O corpus é sintético, de uma única empresa fictícia, com textos escritos
  a partir de modelos; os resultados não se generalizam diretamente para bases corporativas reais,
  maiores e mais ruidosas. Os modelos são pequenos e quantizados (4 bilhões de parâmetros) e rodaram
  na CPU, numa única máquina.
- **Validade de construto.** A H1 foi medida como latência do sistema, não como o tempo de uma
  pessoa até encontrar a resposta (ADR 006). A H3 foi medida em linhas e arquivos alterados e no
  reuso por um cliente mínimo, o que não esgota "portabilidade e organização".
- **Validade interna.** O autor implementou as quatro configurações e fez as duas integrações da
  H3, conhecendo o código. O gabarito é derivado automaticamente dos fatos do gerador, sem anotação
  humana independente.
- **Validade de conclusão.** O `heldout` tem 40 perguntas (36 com resposta), o que limita o poder
  dos testes: diferenças pequenas de qualidade podem não ter sido detectadas. A avaliação humana
  foi uma nota de consenso de dois avaliadores próximos ao autor, sem concordância
  entre avaliadores independentes; os avaliadores não sabiam a configuração de cada resposta. Os
  subgrupos literal e parafraseado são análises secundárias, com poucas perguntas cada.
- **Mitigações.** Arquitetura congelada antes de criar o `heldout` (ADR 010); protocolo e plano de
  análise registrados antes da execução (ADR 011), sem desvios na execução automática; controle C
  para separar estratégia e protocolo; todos os números versionados com o ambiente
  (`results/runs/`) e as tabelas geradas por script.
