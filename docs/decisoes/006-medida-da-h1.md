# 006 — Medida do "tempo de recuperação" da H1

Data: 31/10/2026 · Situação: aceita (decisão do autor)

**Contexto.** A H1 do TCC 1 fala em "tempo médio de recuperação de informação", sem
dizer se é tempo do sistema ou de uma pessoa. Medir o tempo de pessoas exige um estudo
com participantes.

**Decisão.** A H1 é medida como **latência computacional do sistema** por pergunta, em
milissegundos, com relógio monotônico (`performance.now()`), separando:
1. latência só da recuperação (todas as configurações, inclusive A);
2. latência da recuperação + geração (configurações que geram resposta).

Cada pergunta é repetida várias vezes, depois de um aquecimento descartado, em ordem
de configurações embaralhada por rodada, na mesma máquina. Comparação principal A × D,
exigida pelo TCC 1, e decomposição B × C (estratégia) e C × D (protocolo).

**Consequências.** É provável que a busca textual (BM25 em memória) seja mais rápida e
que a H1 seja **refutada**. Isso será reportado como resultado, sem reformular a
hipótese depois de ver os dados. O tempo de uma pessoa até achar a resposta fica como
limitação e trabalho futuro (ou estudo opcional, se houver participantes e prazo).

**Implementação da recuperação + geração (31/10/2026).** `npm run bench:generation`
(`src/bench/generation.ts`), para B, C e D; A não gera resposta e fica só em
`bench:retrieval`.
- Em cada chamada: t0 → recuperação dos 5 trechos do prompt → t1 → prompt, LLM e leitura da
  resposta → t2. Recuperação = t1 − t0; recuperação + geração = t2 − t0, no mesmo relógio.
- A rodada 0 é o aquecimento e dá a resposta avaliada; as rodadas seguintes medem a latência
  e conferem se a resposta se repete (`respostasQueVariaram`).
- O cache de prompts em RAM do `llama-server` fica desligado (`LLAMA_ARG_CACHE_RAM=0`; ADR
  003). Sem isso, a rodada seguinte e D, logo depois de C, reaproveitariam o processamento de
  prompts idênticos. Continua o reaproveitamento do prefixo comum com a chamada imediatamente
  anterior (as instruções fixas), que o Ollama mantém mesmo com
  `LLAMA_ARG_CACHE_PROMPT=false` (testado). C e D têm a mesma sequência de prompts, então o
  efeito é igual nas duas; entre B e C só difere quando duas perguntas seguidas têm o mesmo
  primeiro trecho.
- Medições só com o computador na tomada: `environment.json` grava `powerSource` (macOS).
