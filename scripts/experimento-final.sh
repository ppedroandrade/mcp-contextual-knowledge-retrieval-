#!/usr/bin/env bash
# Experimento final (ADR 011): roda, na ordem, as etapas do protocolo no heldout e o passo 6
# da H3, e grava cada execução em results/runs/<data>-<etapa>. Roteiro completo em
# docs/experimento-final.md.
#
# Uso:
#   scripts/experimento-final.sh                 # todas as etapas, na ordem
#   scripts/experimento-final.sh geracao         # só uma etapa (ou várias, separadas por espaço)
#   MODO=teste scripts/experimento-final.sh      # ensaio sem Ollama nem banco (hash, memória,
#                                                # LLM simulado, sem juiz): só confere o roteiro;
#                                                # os números NÃO têm valor experimental
#
# Variáveis: DATA (padrão: hoje, AAAA-MM-DD) fixa o prefixo das execuções, para retomar uma
# etapa num outro dia com os mesmos ids; H3 aponta a execução da H3 (padrão abaixo).
#
# Etapas: verificar indexar recuperacao geracao respostas planilha politicas estatistica conferir tabelas
set -euo pipefail
cd "$(dirname "$0")/.."

MODO="${MODO:-real}"
DATA="${DATA:-$(date +%F)}"
H3="${H3:-2026-11-01-h3-integracao-politicas}"
GERADOR="qwen3:4b-instruct-2507-q4_K_M"
JUIZ="${JUDGE_MODEL:-qwen3.5:4b}"
OLLAMA="${OLLAMA_URL:-http://localhost:11434}"

# Protocolo fixado no ADR 011 (não mudar depois de começar).
RODADAS_RECUPERACAO=10
RODADAS_GERACAO=5
REPETICOES_JUIZ=2
RODADAS_POLITICAS=5

if [[ "$MODO" == "teste" ]]; then
  PREFIXO="teste-$DATA"
  OPCOES=(--embedder hash --store memory)
  OPCOES_LLM=(--llm simulated)
  OPCOES_JUIZ=(--judge none)
else
  PREFIXO="$DATA"
  OPCOES=(--embedder ollama --store pg)
  OPCOES_LLM=(--llm ollama --model "$GERADOR")
  OPCOES_JUIZ=(--judge "$JUIZ" --repeats "$REPETICOES_JUIZ")
fi

REC="$PREFIXO-heldout-recuperacao"
GER="$PREFIXO-heldout-geracao"
RESP="$PREFIXO-heldout-avaliacao"
PLAN="$PREFIXO-heldout-planilha-cega"
POL="$PREFIXO-politicas-recuperacao"

passo() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
falha() { printf '\033[31merro: %s\033[0m\n' "$*" >&2; exit 1; }
aviso() { printf '\033[33maviso: %s\033[0m\n' "$*" >&2; }
existe() { [[ -f "results/runs/$1/environment.json" ]]; }
nao_sobrescrever() { if existe "$1"; then falha "results/runs/$1 já existe; use outro DATA= (ADR 011: etapa que falhou é repetida inteira, com outro id)"; fi; }

# Descarrega todos os modelos do Ollama e espera /api/ps vazio (a VM do Docker tem 7,7 GiB).
descarregar() {
  [[ "$MODO" == "teste" ]] && return 0
  local modelos
  modelos=$(curl -sf "$OLLAMA/api/ps" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log((JSON.parse(s).models||[]).map(m=>m.name).join(" ")))')
  for m in $modelos; do docker compose exec -T ollama ollama stop "$m" || true; done
  for _ in $(seq 1 60); do
    [[ -z "$(curl -sf "$OLLAMA/api/ps" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log((JSON.parse(s).models||[]).length||""))')" ]] && return 0
    sleep 2
  done
  falha "o Ollama não descarregou os modelos em 2 minutos (veja $OLLAMA/api/ps)"
}

verificar() {
  passo "verificação do ambiente"
  local major
  major=$(node -p 'process.versions.node.split(".")[0]')
  [[ "$major" == "22" ]] || falha "as medições exigem Node 22 (atual: $(node -v)); rode: nvm use"
  [[ -z "$(git status --porcelain -- . ':!results')" ]] || falha "a árvore do git tem mudanças fora de results/; faça commit ou stash antes"
  echo "commit: $(git rev-parse HEAD) ($(git rev-parse --abbrev-ref HEAD))"
  npm run check
  if [[ "$MODO" != "teste" ]]; then
    if command -v pmset >/dev/null; then
      pmset -g batt | grep -q "AC Power" || falha "o Mac não está na tomada"
      pmset -g | grep -E "lowpowermode|powermode" || true
    fi
    curl -sf "$OLLAMA/api/version" || falha "Ollama não responde em $OLLAMA (docker compose up -d)"
    echo
    local tags
    tags=$(curl -sf "$OLLAMA/api/tags")
    for m in bge-m3 "$GERADOR" "$JUIZ"; do
      grep -q "\"$m" <<<"$tags" || falha "modelo $m não está no Ollama: docker compose exec ollama ollama pull $m"
    done
    [[ "$JUIZ" != "$GERADOR" ]] || falha "o juiz não pode ser o gerador"
    npm run test:integration
  fi
}

indexar() {
  [[ "$MODO" == "teste" ]] && return 0
  passo "indexação (3 fontes para o heldout; 4 fontes para o conjunto de políticas)"
  descarregar
  npm run ingest
  npm run ingest -- --sources docs,tickets,incidents,policies
}

recuperacao() {
  passo "H1/H2: recuperação no heldout (A, B, C, D; $RODADAS_RECUPERACAO rodadas)"
  nao_sobrescrever "$REC"
  descarregar
  npm run bench:retrieval -- --set heldout --approaches A,B,C,D --rounds "$RODADAS_RECUPERACAO" "${OPCOES[@]}" --out "$REC"
}

geracao() {
  passo "H1/H2: recuperação + geração no heldout (B, C, D; $RODADAS_GERACAO rodadas)"
  nao_sobrescrever "$GER"
  descarregar
  npm run bench:generation -- --set heldout --approaches B,C,D --rounds "$RODADAS_GERACAO" "${OPCOES[@]}" "${OPCOES_LLM[@]}" --out "$GER"
}

respostas() {
  passo "H2: avaliação automática das respostas (regra dos fatos + juiz)"
  existe "$GER" || falha "rode antes a etapa geracao ($GER)"
  nao_sobrescrever "$RESP"
  descarregar
  npm run eval:answers -- --run "$GER" "${OPCOES_JUIZ[@]}" --out "$RESP"
}

planilha() {
  passo "H2: planilha cega para a avaliação humana"
  existe "$GER" || falha "rode antes a etapa geracao ($GER)"
  nao_sobrescrever "$PLAN"
  npm run eval:human -- --run "$GER" --out "$PLAN"
  echo "avaliação na UI: npm run demo -- --avaliacao $PLAN"
}

politicas() {
  passo "H3 (passo 6): recuperação no conjunto de políticas (4 fontes; $RODADAS_POLITICAS rodadas)"
  nao_sobrescrever "$POL"
  descarregar
  npm run bench:retrieval -- --set policies --approaches A,B,C,D --rounds "$RODADAS_POLITICAS" "${OPCOES[@]}" --out "$POL"
}

estatistica() {
  passo "estatística (Wilcoxon, Holm, bootstrap, Mann-Whitney; ADR 008)"
  for id in "$REC" "$GER" "$RESP"; do
    existe "$id" || { aviso "$id não existe; pulando"; continue; }
    npm run stats -- --run "$id"
    npm run stats -- --run "$id" --style literal
    npm run stats -- --run "$id" --style parafraseada
  done
  if existe "$POL"; then npm run stats -- --run "$POL"; else aviso "$POL não existe; pulando"; fi
  if [[ -d "results/runs/$PLAN/avaliacoes" ]]; then
    npm run stats -- --run "$PLAN"
    npm run stats -- --run "$PLAN" --style literal
    npm run stats -- --run "$PLAN" --style parafraseada
  else
    aviso "a planilha $PLAN ainda não tem notas importadas; a estatística da avaliação humana fica para depois"
  fi
}

conferir() {
  passo "conferência C = D e custo do protocolo (D − C, D − tempo da tool)"
  for id in "$REC" "$GER" "$POL"; do
    if existe "$id"; then npx tsx scripts/compare-c-d.ts "$id"; else aviso "$id não existe; pulando"; fi
  done
}

tabelas() {
  passo "tabelas do artigo (só números das execuções gravadas)"
  local args=(--h3 "$H3")
  existe "$REC" && args+=(--recuperacao "$REC")
  existe "$GER" && args+=(--geracao "$GER")
  existe "$RESP" && args+=(--respostas "$RESP")
  existe "$PLAN" && args+=(--humana "$PLAN")
  existe "$POL" && args+=(--politicas "$POL")
  mkdir -p results/artigo
  npx tsx scripts/tabelas-artigo.ts "${args[@]}" --out "results/artigo/tabelas-$PREFIXO.md"
}

ETAPAS=(verificar indexar recuperacao geracao respostas planilha politicas estatistica conferir tabelas)
[[ $# -gt 0 ]] && ETAPAS=("$@")
[[ "$MODO" == "teste" ]] && aviso "MODO=teste: embedder hash, memória e LLM simulado; os números não têm valor experimental"
echo "execuções: $REC, $GER, $RESP, $PLAN, $POL"
for etapa in "${ETAPAS[@]}"; do
  declare -F "$etapa" >/dev/null || falha "etapa desconhecida: $etapa"
  "$etapa"
done
passo "fim"
