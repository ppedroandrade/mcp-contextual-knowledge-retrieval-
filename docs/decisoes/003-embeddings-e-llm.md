# 003 — Embeddings e LLM

Data: 31/10/2026 · Situação: aceita (LLM fixado em 31/10/2026, ver abaixo)

**Contexto.** Sem serviço pago sem aprovação. O corpus e as perguntas são em português.
A versão anterior usou LSA próprio, criticado como pouco representativo de RAG atual.

**Decisão.** Ollama local (no `docker-compose.yml`) para os dois papéis:
- **Embeddings:** `bge-m3` (multilíngue, inclui português). O mesmo modelo e a mesma
  versão para todas as abordagens vetoriais.
- **LLM:** modelo aberto pequeno o bastante para rodar em notebook, escolhido na etapa
  de geração. Temperatura 0, mesmo prompt e mesmo número de trechos para todas as
  abordagens que geram resposta.

O digest de cada modelo (`ollama show --modelfile` / `ollama list`) é gravado em
`results/runs/<id>/environment.json` de cada execução.

**Opções descartadas.** API paga (custo e aprovação); transformers.js no processo
(funciona, mas exigiria um segundo caminho para o LLM); LSA (pouco representativo).

**Consequências.** Primeira execução baixa os modelos (~1-5 GB). Resultados dependem do
hardware só na latência, não na qualidade, desde que o digest seja o mesmo.

**Ambiente de execução (31/10/2026).** No macOS o Ollama do `docker-compose.yml` roda só
na CPU, porque o Docker não acessa a GPU (Metal). Decisão do Pedro: manter o Ollama no
Docker, como no compose, pela portabilidade. A imagem está fixada em `ollama/ollama:0.40.13`
e cada execução grava a versão do Ollama e o `sizeVram` do modelo (0 = só CPU) em
`environment.json`. As latências medidas valem para esse ambiente.

**LLM (31/10/2026).** Candidatos abertos de ~4B parâmetros em Q4_K_M, que cabem na VM do
Docker (7,7 GiB, só CPU) junto com o `bge-m3`. Piloto com o prompt fixo
(`src/generation/prompt.ts`), a abordagem B e as 60 perguntas do `dev`, aquecimento + 1
rodada, na mesma versão do código (commit `5cc13b2`); execuções em
`results/runs/2026-10-31-piloto-llm-*`, resumo recalculado com
`scripts/summarize-generation.ts`. Os critérios foram conformidade com o prompt,
determinismo e custo na CPU; a correção das respostas fica para a etapa de avaliação.

| Modelo | Licença | Abstenção correta (6 sem resposta) | Abstenção com toda a evidência no contexto (27) | Citação inválida | Respostas que mudaram entre rodadas | Tempo por pergunta |
| --- | --- | --- | --- | --- | --- | --- |
| `qwen3:4b-instruct-2507-q4_K_M` | Apache 2.0 | 6/6 | 0/27 | 2/60 | 0/60 | 6,2 s¹ |
| `qwen3.5:4b` (raciocínio desligado) | Apache 2.0 | 6/6 | 0/27 | 0/60 | 3/60 | 6,2 s |
| `gemma3:4b` | Gemma Terms of Use | 5/6 | 5/27 | 3/60 | 38/60 | 7,4 s |

¹ Parte da rodada foi feita na bateria. Tempos indicativos (1 rodada).

**Decisão:** `qwen3:4b-instruct-2507-q4_K_M`, digest
`0edcdef34593eac1aa2be9c7d06c432dcf81945adca5eca2f27662c18f168ba0`. O critério decisivo é o
determinismo: C e D recebem trechos idênticos e precisam dar a mesma resposta, e a resposta
avaliada precisa ser reproduzível; com temperatura 0, o `gemma3` mudou 38 respostas e o
`qwen3.5`, 3. Também pesaram a abstenção correta, nenhuma abstenção com a evidência no
contexto e o menor uso de memória (4,8 GiB no container, contra 5,5 GiB do `qwen3.5`). Custo
aceito: 2 citações inválidas em 60, que seguem medidas em `citacaoInvalida`.

Opções fixas (`src/generation/ollama.ts`): temperatura 0, semente 42, `num_ctx` 5120 (comporta
o pior caso do corpus, 3925 bytes, com a resposta máxima), `num_predict` 512 e modo de
raciocínio desligado (`think: false`) nos modelos que o declaram, como este.

**Configuração do Ollama no Docker (31/10/2026).** Duas falhas reais do primeiro piloto
levaram a fixar no `docker-compose.yml`:
- `OLLAMA_MAX_LOADED_MODELS=2` e `OLLAMA_NUM_PARALLEL=1`: na CPU o Ollama calcula mal a
  memória livre e manteve vários LLMs carregados até o runner ser morto (OOMKilled). Ao
  trocar de LLM, descarregar o anterior: `docker compose exec ollama ollama stop <modelo>`.
- `LLAMA_ARG_CACHE_RAM=0`: o `llama-server` guardava em RAM o estado de cada prompt (até
  8 GiB, mais que a VM) e o runner morria depois de umas 25 perguntas. O mesmo cache faria as
  rodadas repetidas, e D depois de C, reaproveitarem prompts idênticos (ver ADR 006).
