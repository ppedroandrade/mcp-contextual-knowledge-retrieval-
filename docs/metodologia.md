# Metodologia: do TCC 1 para a implementação

Fonte: TCC 1 aprovado (`ANEXO_SR_122939_...pdf`, maio/2026), seções 4, 5, 8 e 10.
Este documento liga cada hipótese e objetivo do TCC 1 ao que será medido e onde.
Situação: **em implementação** (geração, avaliação das respostas e estatística implementadas; ADR 007 e 008).

## 1. O que o TCC 1 exige

| Item do TCC 1 | Texto (resumo fiel) |
| --- | --- |
| H1 | Redução estatisticamente significativa no **tempo médio de recuperação** de informação com MCP + RAG em comparação à **busca textual convencional**; α = 0,05, Mann-Whitney U, corpus controlado |
| H2 | Melhoria na **qualidade percebida das respostas**, medida por **avaliação humana especializada** e por **métricas automatizadas de qualidade de recuperação**, em comparação ao acesso direto à documentação dispersa |
| H3 | Maior **portabilidade e organização** no acesso a fontes heterogêneas, comparada a integrações customizadas sem MCP; **análise qualitativa do esforço de adaptação arquitetural** |
| Baselines | (i) RAG puro sem MCP; (ii) busca textual convencional |
| Protótipo | ≥ 3 fontes heterogêneas; pgvector ou Qdrant; Node.js; ponta a ponta, da ingestão à **geração de respostas** |
| Dataset | Pares pergunta-resposta de referência construídos a partir do corpus |
| Métricas citadas | tempo médio de recuperação; avaliação humana; métricas automatizadas (RAGAS como exemplo); análise qualitativa das integrações |
| Estatística | descritiva + Mann-Whitney U, α = 0,05 |
| Corpus | documentação técnica anonimizada **ou sintética** (LGPD, sem CEP) |

## 2. Mapeamento para a implementação

| Hipótese | Medida | Configurações | Onde no código |
| --- | --- | --- | --- |
| H1 | Latência computacional por pergunta (ms): só recuperação e recuperação + geração, separadas | A × D (exigido); B × D e C × D (decomposição) | `src/bench`, `src/evaluation/stats` |
| H2 (automática) | Recuperação: Recall@k, Precision@k, MRR, nDCG@k contra o gabarito. Resposta: checagem por regra dos fatos e juiz por LLM (correção, completude, sustentação) | B, C, D (geram resposta); A só recuperação | `src/evaluation/metrics.ts`, `facts.ts`, `judge.ts`; `npm run eval:answers` (ADR 007) |
| H2 (humana) | Rubrica 1–5 de correção, completude e sustentação nas evidências, por ≥ 2 avaliadores cegos à configuração; concordância pelo alfa de Krippendorff ordinal | B, C, D | `src/evaluation/human.ts`; `npm run eval:human` exporta a planilha cega e importa as notas (ADR 007) |
| H3 | Integração de uma 4ª fonte depois do congelamento: arquivos e linhas alteradas no host, no servidor e nos testes; reuso do servidor por um segundo cliente MCP sem alteração | B/C (customizado) × D (MCP) | `docs/h3-protocolo.md`, ADR 009, `results/runs/2026-11-01-h3-integracao-politicas/h3.json` |

## 2.1 Parâmetros de recuperação

Cada abordagem devolve as 50 unidades mais bem pontuadas; P, R, MRR e nDCG são
calculadas sobre os documentos dessa lista, na ordem da primeira aparição, com k = 5;
ER@5 e "completas@5" são calculadas sobre as 5 primeiras unidades. Perguntas sem
resposta ficam fora das métricas de recuperação. A latência é medida em várias rodadas,
com uma rodada de aquecimento descartada e ordem das abordagens embaralhada.

## 3. Divergências entre o TCC 1 e o que será feito

Registrar no artigo, de preferência com o aval do orientador.

1. **SDK do MCP em Python × Node.js.** O TCC 1 diz "SDK oficial do MCP em Python" e, na
   mesma frase, "Node.js como linguagem principal". Será usado o SDK oficial em
   **TypeScript** (ADR 004), o que mantém um único runtime. O SDK é o mesmo protocolo.
2. **Mann-Whitney U × dados pareados.** Todas as configurações respondem às mesmas
   perguntas, então as observações são pareadas por pergunta. O teste principal é o
   **Wilcoxon pareado**, com correção de Holm para várias comparações e IC 95% por
   bootstrap; o Mann-Whitney U é reportado ao lado, para cumprir o texto do TCC 1, com a
   justificativa da troca. Implementado em `src/evaluation/stats.ts` (ADR 008).
3. **RAGAS.** É uma biblioteca Python e depende de um LLM avaliador. Opções: (a) métricas
   equivalentes implementadas em TypeScript com o LLM local como avaliador; (b) RAGAS em
   script auxiliar Python, só na avaliação. Em qualquer caso, a avaliação automática
   **não substitui** a humana. **Decidido (ADR 007):** opção (a), com o LLM local como juiz
   e uma checagem por regra dos fatos como âncora; o RAGAS não é usado.
4. **Configuração C** (busca por fonte sem MCP) não está no TCC 1. É acrescentada como
   controle para separar o efeito do protocolo do efeito da estratégia (ADR 005).
5. **RSL** (Fase 1 do TCC 1) é trabalho do artigo, não do software, e não está neste
   repositório.

## 4. Riscos que precisam de decisão

- **H1 e o significado de "tempo de recuperação".** Decidido: latência computacional do
  sistema ([ADR 006](decisoes/006-medida-da-h1.md)). A busca textual tende a ser mais
  rápida, então a H1 provavelmente será **refutada**, e isso será reportado como
  resultado. O tempo de uma pessoa fica como limitação.
- **Sobreposição lexical entre perguntas e corpus.** Muitas perguntas do `dev` repetem
  termos literais do texto (nome do serviço, sintoma do incidente). Isso favorece a busca
  textual (A). Na rodada de verificação do BM25 no `dev` (não é resultado do experimento),
  R@5 por documento ficou alto e ER@5 multifonte ficou bem menor. O conjunto `heldout`
  inclui 16 perguntas parafraseadas (de 36 com resposta), sem os termos literais, para medir
  o ganho da busca semântica; a análise por estilo foi prevista antes da execução final
  (`docs/corpus.md`).
- **H2 humana** exige ao menos 2 avaliadores além do autor.
- **Autor constrói corpus, gabarito e solução.** Mitigação: corpus gerado por código com
  semente fixa, arquitetura congelada antes de criar um conjunto reservado de perguntas,
  e revisão do gabarito por outra pessoa, se possível.
