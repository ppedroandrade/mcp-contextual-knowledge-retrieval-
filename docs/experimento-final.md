# Roteiro do experimento final (no Mac)

Situação: **pronto para executar**; ensaiado em 01/11/2026 com `MODO=teste` (hash, memória, LLM
simulado), que só confere o roteiro. Protocolo e plano de análise fixados no ADR 011.

## 1. Antes de começar (uma vez)

```bash
nvm install 22 && nvm use            # .nvmrc; os bench recusam outra versão
git checkout main && git pull        # árvore limpa, sem trocar de branch durante a execução
npm ci
docker compose up -d
docker compose exec ollama ollama pull bge-m3
docker compose exec ollama ollama pull qwen3:4b-instruct-2507-q4_K_M
docker compose exec ollama ollama pull qwen3.5:4b
```

- Mac na tomada, tampa aberta, sem outros programas pesados; anote o modo de energia
  (`pmset -g`), que o script imprime.
- Ensaio rápido (minutos, sem Ollama): `MODO=teste scripts/experimento-final.sh recuperacao geracao respostas planilha politicas estatistica conferir tabelas`.
  Depois, apague `results/runs/teste-*` e `results/artigo/` (não versionar).

## 2. Execução

```bash
scripts/experimento-final.sh
```

Roda, na ordem: `verificar` (Node 22, árvore limpa, `npm run check`, tomada, modelos, juiz ≠
gerador, `test:integration`), `indexar`, `recuperacao`, `geracao`, `respostas`, `planilha`,
`politicas`, `estatistica`, `conferir` e `tabelas`. As execuções ficam em
`results/runs/<data>-heldout-recuperacao`, `-heldout-geracao`, `-heldout-avaliacao`,
`-heldout-planilha-cega` e `<data>-politicas-recuperacao`.

Tempo estimado a partir do `dev` (60 perguntas): a geração levou ~6,2 s por resposta; com 40
perguntas × 3 configurações × 6 passagens, ~75 min. Recuperação, juiz e políticas somam menos
de 30 min. É uma estimativa, não uma medida.

Para retomar uma etapa noutro dia com os mesmos ids: `DATA=AAAA-MM-DD scripts/experimento-final.sh <etapa>`.
O script recusa sobrescrever uma execução existente (ADR 011: etapa que falhou é repetida
inteira, com outro id).

## 3. Avaliação humana (H2)

1. `npm run demo -- --avaliacao <data>-heldout-planilha-cega` (só Node) e abra
   http://127.0.0.1:3000 para cada avaliador, que entra com o próprio nome. As notas ficam em
   `results/runs/<planilha>/avaliacoes-ui/<nome>.csv`; a tela mostra o alfa com 2 ou mais.
   (Para avaliar em outra máquina da rede: `--host 0.0.0.0`.)
2. Com todos os avaliadores prontos:
   ```bash
   npm run eval:human -- --import <planilha> --ratings results/runs/<planilha>/avaliacoes-ui/ana.csv,results/runs/<planilha>/avaliacoes-ui/bruno.csv
   DATA=<data> scripts/experimento-final.sh estatistica tabelas
   ```

## 4. Depois

- Versione `results/runs/<data>-*` e `results/artigo/tabelas-<data>.md` num PR próprio.
- Atualize o STATUS (validado) e preencha `docs/artigo/secoes-3-4.md` **só** com números das
  tabelas geradas, citando a execução.
- Opcional (H3, passo 5 com um cliente de terceiros): `npx @modelcontextprotocol/inspector --cli npx tsx src/mcp/stdio.ts --method tools/list`.
