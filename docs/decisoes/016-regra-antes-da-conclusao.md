# 016 — Nexo: a regra antes da conclusão

Data: 01/11/2026 · Situação: aceita

**Contexto.** O Pedro perguntou ao Nexo "Uma despesa de R$ 2.500 pode ser aprovada pelo meu
gestor direto?". A resposta começou com "Sim, ... pode ser aprovada pelo gestor direto, mas
apenas até R$ 2.000,00 [1]" e terminou com "não pode ser aprovada pelo gestor direto". O fato
estava certo e citado; a conclusão inicial, errada.

O LLM (`qwen3` 4B, sem modo de raciocínio, ADR 003) escreve palavra por palavra. Ele se
comprometia com "Sim" antes de comparar o valor da pergunta com o limite do trecho. Numa
pergunta parecida ("O Uber da minha casa até o aeroporto é reembolsado?"), ele começou com
"Sim" e inventou uma condição que o trecho não tem ("entre a casa, o aeroporto e o cliente").

**Decisão.** As instruções que acompanham os trechos (`ANSWER_RULES`, `src/assistant/chat.ts`)
ganharam uma regra para perguntas de sim ou não, ou que dependem de um valor, prazo, limite ou
condição:
- não começar por "Sim" nem por "Não";
- escrever primeiro a regra como está no trecho, com a citação;
- só depois concluir para o caso perguntado, sem acrescentar condições que o trecho não tem.

Assim o modelo já escreveu a regra quando chega à conclusão. A mudança vale só para o Nexo;
`src/generation` e as medições do TCC não mudam (ADR 012).

**Verificação manual (01/11/2026, fora das métricas).** Foram 11 perguntas sobre a wiki de
exemplo e os documentos do Pedro, rodadas pelo fluxo real com `bge-m3`, pgvector e `qwen3`:
limites de aprovação (com um seguimento), refeição, prazo de lançamento, home office, Uber e
reprocessamento de fatura, além de duas perguntas diretas.
- **Antes:** duas respostas se contradiziam (R$ 2.500 e Uber), e o Uber trazia a condição
  inventada.
- **Depois:** as 11 chegaram à conclusão que o trecho sustenta.

Uma ficou imprecisa: na nota fiscal de 45 dias, a resposta diz que não é possível lançar e,
logo depois, que o lançamento fora do prazo precisa de aprovação do diretor da área.

**Consequências.**
- As respostas a perguntas de sim ou não ficam um pouco mais longas, porque começam pela regra.
- 11 perguntas não garantem o comportamento com outros documentos.
- Um modelo maior, ou com raciocínio, reduziria o problema na origem, ao custo de tempo de
  resposta na CPU.
