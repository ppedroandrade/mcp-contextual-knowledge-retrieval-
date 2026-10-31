# generation
Geração de respostas por LLM a partir dos trechos recuperados (ADR 003). Mesmo prompt,
modelo e contexto (os 5 primeiros trechos) para B, C e D; A não gera resposta.

- `provider.ts`: interface `LlmProvider`.
- `ollama.ts`: chat do Ollama com temperatura 0, semente, `num_ctx` e `num_predict` fixos.
- `simulated.ts`: provedor determinístico para testes; sem valor experimental.
- `prompt.ts`: instruções fixas e montagem da mensagem; o hash do prompt vai para cada
  execução e é fixado num teste.
- `answer.ts`: gera a resposta e lê as citações `[id]` e a abstenção ("Não sei").
