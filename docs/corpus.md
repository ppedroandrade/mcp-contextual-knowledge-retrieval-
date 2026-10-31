# Corpus sintético e perguntas de avaliação — proposta

Situação: **planejado**. Todos os dados são sintéticos (empresa fictícia), sem dados reais.

## 1. Empresa fictícia

"Orbital Software", empresa de SaaS B2B com ~200 pessoas, que mantém um produto de
faturamento ("Orbital Billing") com API pública, app web e integrações de pagamento.
Fatos centrais (serviços, versões, times, clientes fictícios, datas) ficam num único
arquivo de "mundo" (`src/corpus/world.ts`) do qual todas as fontes derivam, para que as
fontes sejam **coerentes entre si** (o incidente cita o serviço descrito na wiki, que é
citado no chamado).

## 2. Fontes

A heterogeneidade é de **conteúdo e de formato**, para que a integração de cada fonte
exija trabalho real (base da H3).

| Fonte | Formato no disco | Conteúdo | Quantidade inicial |
| --- | --- | --- | --- |
| `docs` — wiki técnica | pasta de arquivos Markdown com front-matter | arquitetura, runbooks, how-tos, FAQ | ~40 documentos |
| `tickets` — chamados de suporte | JSON (lista de objetos com campos, descrição e comentários) | problemas de clientes, resolução, links para docs | ~80 chamados |
| `incidents` — registros de incidentes | CSV (uma linha por incidente) + linha do tempo em JSON | postmortems: impacto, causa raiz, ações | ~25 incidentes |
| `policies` — políticas internas (**4ª fonte, H3**) | HTML | segurança, LGPD, plantão, acesso | ~15 documentos |

`policies` só é integrada **depois do congelamento** da arquitetura, para medir o esforço
de adicionar uma fonte com formato novo em B/C (customizado) e em D (MCP).

## 3. Perguntas

Formato (`data/questions/*.json`):

```json
{
  "id": "q001",
  "text": "Qual foi a causa raiz da indisponibilidade do webhook de pagamentos em março?",
  "type": "single-source | multi-source | unanswerable",
  "sources": ["incidents"],
  "relevantDocIds": ["INC-2026-007"],
  "evidence": [["INC-2026-007#causa-raiz"]],
  "referenceAnswer": "Expiração do certificado TLS do gateway ...",
  "set": "dev | heldout"
}
```

- `evidence`: unidades de evidência no nível do trecho (cada item interno é uma
  alternativa), para não contar como acerto um trecho irrelevante de um documento certo.
- `unanswerable`: o corpus não tem a resposta; a resposta certa é dizer que não sabe.

| Conjunto | Quando é criado | Tamanho | Mistura |
| --- | --- | --- | --- |
| `dev` | antes de implementar as abordagens | 60 | ~50% fonte única, ~40% multifonte, ~10% sem resposta |
| `heldout` | **depois** do congelamento, sem ajustes posteriores | 40 | inclui distratores e vários relevantes na mesma fonte |

Proporções são escolha de projeto e serão declaradas no artigo.

## 4. Reprodutibilidade

- Gerador determinístico com semente fixa (`npm run corpus`); os JSON/MD/CSV gerados
  são versionados, e um teste confere que regenerar dá o mesmo resultado.
- Cada pergunta é validada por teste: `relevantDocIds` e `evidence` existem no corpus.
- O texto dos documentos é escrito à mão em modelos com variações controladas, sem LLM,
  para não depender de um modelo nem introduzir conteúdo não rastreável.
