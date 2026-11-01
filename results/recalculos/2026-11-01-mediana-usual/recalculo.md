<!-- Gerado por scripts/recalculo-mediana.ts; não editar os números à mão. -->
# Recálculo da latência com a mediana usual (posterior ao experimento)

Correção registrada no ADR 016 e no ADR 010. Gerado em 2026-11-01, commit `745dc56`, Node v22.23.4, a partir dos tempos brutos das execuções abaixo, que não foram alteradas. Nenhuma medição nova foi feita.

Antes: a mediana das rodadas de cada pergunta tomava o central superior quando o número de rodadas era par. Agora: a mediana usual (média dos dois centrais). Só a execução com número par de rodadas muda; as medidas de qualidade não dependem da mediana e não foram refeitas.

Os valores "recalculados" substituem, no artigo, as linhas de latência de `results/artigo/tabelas-2026-11-01.md` que vêm de `2026-11-01-heldout-recuperacao`; os "publicados" são os da v3 do artigo e continuam nos arquivos originais.

## `2026-11-01-heldout-recuperacao` (10 rodadas, commit `2042154`)

Perguntas × configuração com mediana alterada: latência da recuperação (ms): 160.

| Configuração | Medida | Publicado (ms) | Recalculado (ms) |
| --- | --- | --- | --- |
| A-bm25 | latenciaMedianaMs | 0,25 | 0,25 |
| B-rag | latenciaMedianaMs | 36,29 | 34,62 |
| C-por-fonte | latenciaMedianaMs | 112,22 | 108,35 |
| D-mcp | latenciaMedianaMs | 113,44 | 109,29 |

### Testes de latência refeitos (`estatistica.json`)

| Medida | Par | n | Publicado: diferença [IC 95%] | p Holm | Recalculado: diferença [IC 95%] | p Wilcoxon | p Holm | r | p Mann-Whitney (Holm) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| latência da recuperação (ms) | D × A | 40 | 112,65 [102,49; 122,76] | < 0,001 | 105,94 [101,44; 118,25] | < 0,001 | < 0,001 | 1,00 | < 0,001 |
| latência da recuperação (ms) | D × B | 40 | 73,65 [66,80; 90,14] | < 0,001 | 72,51 [61,12; 84,38] | < 0,001 | < 0,001 | 1,00 | < 0,001 |
| latência da recuperação (ms) | C × B | 40 | 72,63 [66,59; 82,32] | < 0,001 | 68,70 [66,01; 81,50] | < 0,001 | < 0,001 | 1,00 | < 0,001 |
| latência da recuperação (ms) | D × C | 40 | 1,83 [-5,49; 6,83] | 0,656 | 1,44 [-6,85; 5,96] | 0,847 | 0,847 | 0,04 | 0,874 |

### Testes de latência refeitos (`estatistica-literal.json`, só `literal`)

| Medida | Par | n | Publicado: diferença [IC 95%] | p Holm | Recalculado: diferença [IC 95%] | p Wilcoxon | p Holm | r | p Mann-Whitney (Holm) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| latência da recuperação (ms) | D × A | 20 | 110,91 [99,86; 134,23] | < 0,001 | 103,12 [97,91; 129,99] | < 0,001 | < 0,001 | 1,00 | < 0,001 |
| latência da recuperação (ms) | D × B | 20 | 73,43 [66,80; 93,94] | < 0,001 | 71,52 [61,12; 91,51] | < 0,001 | < 0,001 | 1,00 | < 0,001 |
| latência da recuperação (ms) | C × B | 20 | 77,01 [66,59; 83,70] | < 0,001 | 74,01 [66,12; 81,85] | < 0,001 | < 0,001 | 1,00 | < 0,001 |
| latência da recuperação (ms) | D × C | 20 | -3,70 [-8,91; 5,73] | 0,756 | -2,33 [-10,61; 4,31] | 0,648 | 0,648 | -0,12 | 0,617 |

### Testes de latência refeitos (`estatistica-parafraseada.json`, só `parafraseada`)

| Medida | Par | n | Publicado: diferença [IC 95%] | p Holm | Recalculado: diferença [IC 95%] | p Wilcoxon | p Holm | r | p Mann-Whitney (Holm) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| latência da recuperação (ms) | D × A | 16 | 119,91 [111,55; 130,77] | < 0,001 | 116,39 [106,67; 123,66] | < 0,001 | < 0,001 | 1,00 | < 0,001 |
| latência da recuperação (ms) | D × B | 16 | 86,55 [71,00; 93,19] | < 0,001 | 81,63 [70,44; 89,03] | < 0,001 | < 0,001 | 1,00 | < 0,001 |
| latência da recuperação (ms) | C × B | 16 | 74,39 [64,91; 89,76] | < 0,001 | 71,89 [65,05; 86,16] | < 0,001 | < 0,001 | 1,00 | < 0,001 |
| latência da recuperação (ms) | D × C | 16 | 8,26 [-0,53; 15,44] | 0,231 | 5,96 [-3,23; 13,36] | 0,252 | 0,252 | 0,34 | 0,462 |

### Diagnóstico C × D (`scripts/compare-c-d.ts`), recuperação

| Método | D − C: p25 | mediana | p75 | D mais lento | IQR de C (mediana) | D − tool: p25 | mediana | p75 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| anterior (central superior, posto mais próximo) | -9,26 | 2,08 | 14,15 | 22/40 | 29,55 | 1,60 | 1,64 | 1,68 |
| corrigido (mediana usual, quantil tipo 7) | -11,06 | 1,44 | 10,67 | 21/40 | 34,81 | 1,58 | 1,62 | 1,66 |

## `2026-11-01-heldout-geracao` (5 rodadas, commit `2042154`)

Número ímpar de rodadas: nenhuma mediana por pergunta muda; resumo e testes publicados continuam válidos (testes não refeitos).

| Configuração | Medida | Publicado (ms) | Recalculado (ms) |
| --- | --- | --- | --- |
| D-mcp | latenciaRecuperacaoMs | 111,81 | 111,81 |
| D-mcp | latenciaTotalMs | 5688,66 | 5688,66 |
| B-rag | latenciaRecuperacaoMs | 41,07 | 41,07 |
| B-rag | latenciaTotalMs | 5525,08 | 5525,08 |
| C-por-fonte | latenciaRecuperacaoMs | 113,65 | 113,65 |
| C-por-fonte | latenciaTotalMs | 5753,23 | 5753,23 |

### Diagnóstico C × D (`scripts/compare-c-d.ts`), recuperação

| Método | D − C: p25 | mediana | p75 | D mais lento | IQR de C (mediana) | D − tool: p25 | mediana | p75 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| anterior (central superior, posto mais próximo) | -15,69 | -1,94 | 9,93 | 17/40 | 29,99 | 0,91 | 1,00 | 1,05 |
| corrigido (mediana usual, quantil tipo 7) | -11,87 | -2,99 | 10,69 | 17/40 | 29,94 | 0,93 | 1,00 | 1,05 |

### Diagnóstico C × D (`scripts/compare-c-d.ts`), recuperação + geração

| Método | D − C: p25 | mediana | p75 | D mais lento | IQR de C (mediana) | D − tool: p25 | mediana | p75 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| anterior (central superior, posto mais próximo) | -161,41 | -54,86 | 59,82 | 16/40 | 240,39 | — | — | — |
| corrigido (mediana usual, quantil tipo 7) | -157,04 | -56,22 | 60,97 | 16/40 | 237,58 | — | — | — |

## `2026-11-01-politicas-recuperacao` (5 rodadas, commit `2042154`)

Número ímpar de rodadas: nenhuma mediana por pergunta muda; resumo e testes publicados continuam válidos (testes não refeitos).

| Configuração | Medida | Publicado (ms) | Recalculado (ms) |
| --- | --- | --- | --- |
| A-bm25 | latenciaMedianaMs | 0,25 | 0,25 |
| B-rag | latenciaMedianaMs | 30,23 | 30,23 |
| C-por-fonte | latenciaMedianaMs | 109,63 | 109,63 |
| D-mcp | latenciaMedianaMs | 110,62 | 110,62 |

### Diagnóstico C × D (`scripts/compare-c-d.ts`), recuperação

| Método | D − C: p25 | mediana | p75 | D mais lento | IQR de C (mediana) | D − tool: p25 | mediana | p75 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| anterior (central superior, posto mais próximo) | -7,26 | -1,33 | 8,90 | 7/15 | 11,61 | 1,55 | 1,56 | 1,68 |
| corrigido (mediana usual, quantil tipo 7) | -5,64 | -1,33 | 8,95 | 7/15 | 11,61 | 1,55 | 1,56 | 1,70 |
