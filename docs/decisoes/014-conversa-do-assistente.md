# 014 — Conversa do assistente: quando buscar nas fontes

Data: 01/11/2026 · Situação: aceita

**Contexto.** Na primeira versão do assistente (ADR 012), toda mensagem passava pela busca e o
prompt mandava responder só com os trechos. Um "olá" virava "não encontrei nas fontes", e
pedidos sobre a própria conversa ("resuma isso") buscavam trechos que não tinham relação com
o pedido. O Pedro pediu um chat de conversa, não só de perguntas exatas.

**Decisão.**
1. **O LLM decide quando buscar (tool calling).** O `qwen3` recebe a ferramenta
   `buscar_nas_fontes(consulta)` e escreve a consulta a partir da conversa; por exemplo, "e
   o rollback?" vira "rollback do auth-service". O host executa a busca pelo servidor MCP e
   funde por RRF, como a configuração D. O modelo recebe os 5 trechos como resultado da
   ferramenta e responde citando `[n]`.
2. **Conversa sem busca só numa lista clara** (`isConversational`):
   - cumprimentos e agradecimentos;
   - pedidos para transformar a resposta anterior ("resuma", "em tópicos", "traduza",
     "mais curto").
   Nesses casos a ferramenta nem é oferecida, e a resposta usa o histórico (últimos 8 turnos).
3. **Todo o resto passa pela busca.** Se o modelo começar a responder direto em vez de chamar
   a ferramenta, essa resposta é descartada antes de chegar à tela, e a busca é feita com a
   consulta de reserva (a pergunta, junto da anterior quando é curta).
4. **As regras de citação vão junto com os trechos**, não no prompt de sistema. Dado da empresa
   sai só dos trechos, com citação. Pedido geral ("escreva uma mensagem pro time") é atendido
   normalmente. Uma resposta sem busca perde as marcas `[n]`, porque não há trecho para elas
   apontarem.

**Por que não deixar a decisão só com o modelo.** Nos testes com o `qwen3:4b-instruct-2507`
houve dois problemas:
- **Prompt com "diga que não encontrou":** o modelo respondia isso sem buscar, nas perguntas
  sobre a empresa.
- **Sem essa regra:** ainda respondia algumas perguntas de seguimento sem buscar e **inventou
  um canal de plantão** ("#ops-plantão"; o certo, no runbook, é "#oncall-plataforma").

Errar para o lado de buscar custa alguns segundos; errar para o lado de não buscar inventa
dados da empresa.

**Verificação** (01/11/2026, `bge-m3` + `qwen3` na CPU, wiki de exemplo e dois documentos de
RH). Conversa de 8 mensagens, todas com o comportamento esperado:

| Mensagem | Comportamento | Tempo |
| --- | --- | --- |
| "olá", "valeu!" | sem busca | 2–3 s |
| "resuma isso em uma frase" | sem busca, pelo histórico | 2 s |
| perguntas sobre a empresa | busca com a consulta escrita pelo modelo; resposta citada | 13–15 s |
| dois seguimentos que o modelo tentou responder direto | busca forçada; respostas corretas e citadas | 15–19 s |

Não é uma execução gravada em `results/`, porque fica fora das métricas do TCC. Os testes
unitários (`test/unit/assistant.test.ts`) cobrem a lista de conversa, a busca decidida pelo
modelo e o descarte da resposta direta.

**Consequências.**
- **Latência:** perguntas sobre a empresa fazem duas passagens pelo modelo (a decisão e a
  resposta).
- **Lista de conversa:** é conservadora. Uma mensagem fora dela que não precisasse de busca só
  fica mais lenta, sem perder a resposta.
- **Modelo maior:** com um modelo maior ou em GPU, vale medir de novo se a decisão pode ficar só
  com ele.
