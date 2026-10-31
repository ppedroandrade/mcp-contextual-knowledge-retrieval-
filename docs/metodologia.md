# Metodologia: do TCC 1 para a implementação

Fonte: TCC 1 aprovado (`ANEXO_SR_122939_...pdf`, maio/2026), seções 4, 5, 8 e 10.
Este documento liga cada hipótese e objetivo do TCC 1 ao que será medido e onde.
Situação: **planejado**.

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
| H2 (automática) | Recuperação: Recall@k, Precision@k, MRR, nDCG@k contra o gabarito. Resposta: fidelidade e correção contra a resposta de referência | B, C, D (geram resposta); A só recuperação | `src/evaluation/metrics`, `src/evaluation/answers` |
| H2 (humana) | Rubrica 1–5 de correção, completude e sustentação nas evidências, por ≥ 2 avaliadores cegos à configuração; concordância (kappa ponderado ou Krippendorff α) | B, C, D | `src/evaluation/human` (exporta planilha cega, importa notas) |
| H3 | Integração de uma 4ª fonte depois do congelamento: arquivos e linhas alteradas no host, no servidor e nos testes; reuso do servidor por um segundo cliente MCP sem alteração | B/C (customizado) × D (MCP) | `docs/h3-protocolo.md` (a criar), `results/runs/<id>/h3.json` |

## 3. Divergências entre o TCC 1 e o que será feito

Registrar no artigo, de preferência com o aval do orientador.

1. **SDK do MCP em Python × Node.js.** O TCC 1 diz "SDK oficial do MCP em Python" e, na
   mesma frase, "Node.js como linguagem principal". Será usado o SDK oficial em
   **TypeScript** (ADR 004), o que mantém um único runtime. O SDK é o mesmo protocolo.
2. **Mann-Whitney U × dados pareados.** Todas as configurações respondem às mesmas
   perguntas, então as observações são pareadas por pergunta. O teste adequado é o
   **Wilcoxon pareado** (com correção de Holm para várias comparações e intervalo de
   confiança por bootstrap). O Mann-Whitney U será reportado também, para cumprir o
   texto do TCC 1, com a justificativa da troca.
3. **RAGAS.** É uma biblioteca Python e depende de um LLM avaliador. Opções: (a) métricas
   equivalentes implementadas em TypeScript com o LLM local como avaliador; (b) RAGAS em
   script auxiliar Python, só na avaliação. Em qualquer caso, a avaliação automática
   **não substitui** a humana. A decisão fica para a etapa de avaliação.
4. **Configuração C** (busca por fonte sem MCP) não está no TCC 1. É acrescentada como
   controle para separar o efeito do protocolo do efeito da estratégia (ADR 005).
5. **RSL** (Fase 1 do TCC 1) é trabalho do artigo, não do software, e não está neste
   repositório.

## 4. Riscos que precisam de decisão

- **H1 e o significado de "tempo de recuperação".** Decidido: latência computacional do
  sistema ([ADR 006](decisoes/006-medida-da-h1.md)). A busca textual tende a ser mais
  rápida, então a H1 provavelmente será **refutada**, e isso será reportado como
  resultado. O tempo de uma pessoa fica como limitação.
- **H2 humana** exige ao menos 2 avaliadores além do autor.
- **Autor constrói corpus, gabarito e solução.** Mitigação: corpus gerado por código com
  semente fixa, arquitetura congelada antes de criar um conjunto reservado de perguntas,
  e revisão do gabarito por outra pessoa, se possível.
