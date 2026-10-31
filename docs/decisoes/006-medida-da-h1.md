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
