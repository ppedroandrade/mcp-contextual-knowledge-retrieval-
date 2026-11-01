# results
Resultados brutos e agregados de execuções reais, um diretório por execução (`runs/<data>-<id>/`). Nada aqui é escrito à mão.

`recalculos/<data>-<id>/` guarda recálculos **posteriores** a uma execução, feitos só a partir
dos dados brutos de `runs/` (sem medição nova), quando um defeito do código de análise é
corrigido. Os arquivos de `runs/` nunca são regravados; cada recálculo traz os valores
publicados e os recalculados lado a lado e cita o ADR da correção
(`recalculos/2026-11-01-mediana-usual/`, ADR 016).
