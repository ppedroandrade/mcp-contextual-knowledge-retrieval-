# 015 — Docker: banco, LLM e Nexo de uma vez

Data: 01/11/2026 · Situação: aceita

**Contexto.** Até aqui o `docker-compose.yml` subia só o banco e o Ollama. Os modelos eram
baixados à mão e o Nexo rodava com `npm run assistente` no computador. O Pedro pediu para
subir tudo junto, de uma vez.

**Decisão.** `docker compose up -d` sobe quatro serviços:
- `postgres` e `ollama`: as mesmas imagens e a mesma configuração do Ollama de antes (ADR 003),
  agora com verificação de saúde no Ollama e `restart: unless-stopped`.
- `modelos`: baixa o `bge-m3` e o `qwen3:4b-instruct-2507-q4_K_M` na primeira vez (~3,7 GB);
  nas seguintes, só confere e termina. O juiz do TCC (`qwen3.5:4b`) não entra.
- `assistente`: o Nexo. O `Dockerfile` usa `node:22.23.4-bookworm-slim` e roda o TypeScript com
  `tsx`, sem build. O serviço:
  - só começa com o banco saudável e os modelos baixados;
  - fala com o banco e o Ollama pela rede interna do Docker;
  - publica a porta só em `127.0.0.1:3100`, porque o protótipo não tem login (ADR 012);
  - guarda o estado em `./.assistente`, o mesmo do `npm run assistente`;
  - carrega a wiki de exemplo na primeira vez.

**O TCC não muda.** O banco e o Ollama continuam nas portas 5432 e 11434 do computador, e as
medições continuam rodando pelos scripts, fora do container (ADR 011). Durante uma medição, o
Nexo **não** pode estar usando o mesmo Ollama. Para medir, suba só os serviços do experimento
(`docker compose up -d postgres ollama`) ou pare o Nexo (`docker compose stop assistente`).

**Consequências.**
- A primeira subida baixa os modelos.
- A imagem do Nexo leva as devDependencies, porque o `tsx` é uma delas.
- Com `restart: unless-stopped`, os serviços voltam sozinhos quando o Docker reinicia, até um
  `docker compose stop` ou `down`.

**Verificado em 01/11/2026:**
- os três serviços de longa duração ficaram saudáveis;
- o estado e as fontes anteriores foram preservados;
- a conversa funcionou com e sem busca, com citação;
- o `/mcp` respondeu pelo container.
