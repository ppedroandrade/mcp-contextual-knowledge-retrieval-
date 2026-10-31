# Corpus sintético e perguntas de avaliação

Situação: **implementado e testado** (`npm run corpus`, `test/unit/corpus.test.ts`); conjunto `heldout` ainda **planejado**. Todos os dados são sintéticos (empresa fictícia), sem dados reais.

## 1. Empresa fictícia

"Orbital Software", empresa de SaaS B2B com ~200 pessoas, que mantém um produto de
faturamento ("Orbital Billing") com API pública, app web e integrações de pagamento.
Fatos centrais (8 serviços, 10 guias, 25 incidentes, 15 políticas, 12 clientes) ficam
num único arquivo de "mundo" (`src/corpus/world.ts`) do qual todas as fontes derivam,
para que as fontes sejam **coerentes entre si**: o runbook lista os incidentes do
serviço, o chamado cita o incidente ou o guia, e o incidente cita o serviço da wiki.

## 2. Fontes

A heterogeneidade é de **conteúdo e de formato**, para que a integração de cada fonte
exija trabalho real (base da H3).

| Fonte | Formato no disco | Conteúdo | Quantidade inicial |
| --- | --- | --- | --- |
| `docs` — wiki técnica | `data/corpus/docs/*.md` (front-matter + seções `##`) | arquitetura e runbook de cada serviço, guias práticos | 26 documentos |
| `tickets` — chamados de suporte | `data/corpus/tickets/tickets.json` | 25 ligados a incidentes, 30 respondidos com guias, 25 avulsos | 80 chamados |
| `incidents` — registros de incidentes | `data/corpus/incidents/incidents.csv` + `timeline.json` | resumo, causa raiz, ação corretiva, linha do tempo | 25 incidentes |
| `policies` — políticas internas (**4ª fonte, H3**) | `data/corpus/policies/*.html` | segurança, LGPD, plantão, créditos, suporte | 15 políticas |

Cada fonte vira **unidades de evidência** (seção do Markdown, campo do chamado, campo do
incidente, `<section>` do HTML) por um leitor próprio em `src/sources/`.

`policies` só é integrada **depois do congelamento** da arquitetura, para medir o esforço
de adicionar uma fonte com formato novo em B/C (customizado) e em D (MCP).

## 3. Perguntas

Formato (`data/questions/*.json`):

```json
{
  "id": "q009",
  "text": "Qual foi a causa técnica do problema que o cliente Lume Energia relatou em 11/03/2026?",
  "type": "multi-source",
  "set": "dev",
  "sources": ["tickets", "incidents"],
  "relevantDocIds": ["T-1023", "INC-2026-006"],
  "evidence": [["T-1023#resolucao"], ["INC-2026-006#causa-raiz"]],
  "factIds": ["ticket.T-1023.incidente", "inc.INC-2026-006.causa"],
  "referenceAnswer": "O chamado foi ligado ao incidente INC-2026-006, cuja causa raiz foi: ..."
}
```

(Ids ilustrativos; os valores reais estão em `data/questions/dev.json`.)

**O gabarito não é anotado à mão.** Cada pergunta cita fatos do mundo; cada fato foi
registrado no momento em que o texto foi gerado, com a unidade onde aparece. `evidence`,
`relevantDocIds` e `sources` são derivados desses fatos, e um teste confere que o valor
de cada fato aparece literalmente na sua unidade.

- `evidence`: unidades de evidência no nível do trecho (cada item interno é uma
  alternativa), para não contar como acerto um trecho irrelevante de um documento certo.
- `unanswerable`: o corpus não tem a resposta; a resposta certa é dizer que não sabe.

| Conjunto | Quando é criado | Tamanho | Mistura |
| --- | --- | --- | --- |
| `dev` | antes de implementar as abordagens | 60 | 30 fonte única (12 wiki, 9 incidentes, 9 chamados), 24 multifonte (8 incidente+wiki, 8 chamado+incidente, 8 chamado+wiki), 6 sem resposta |
| `policies` | junto com o corpus; usado só depois de integrar a 4ª fonte (H3) | 15 | 10 de fonte única, 5 política+incidente |
| `heldout` | **depois** do congelamento, sem ajustes posteriores | 40 | inclui distratores e vários relevantes na mesma fonte |

Proporções são escolha de projeto e serão declaradas no artigo.

## 4. Reprodutibilidade

- Gerador determinístico com semente fixa (`SEED` em `src/corpus/generate.ts`); os
  arquivos gerados são versionados, e um teste falha se `data/` estiver diferente do
  que o gerador produz.
- `data/corpus/facts.json` lista todos os fatos (349) com a unidade onde aparecem.
- Cada pergunta é validada por teste: `relevantDocIds` e `evidence` existem no corpus.
- O texto dos documentos é escrito à mão em modelos com variações controladas, sem LLM,
  para não depender de um modelo nem introduzir conteúdo não rastreável.
