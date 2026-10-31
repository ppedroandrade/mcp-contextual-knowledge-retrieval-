# 003 — Embeddings e LLM

Data: 31/10/2026 · Situação: aceita (modelo do LLM a fixar na etapa de geração)

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
