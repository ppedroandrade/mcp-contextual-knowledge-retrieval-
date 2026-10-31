# 001 — Linguagem e ferramentas

Data: 31/10/2026 · Situação: aceita

**Contexto.** O TCC exige Node.js; a preferência é TypeScript.

**Decisão.** Node.js 22 LTS (mínimo 22.12), TypeScript 5.9 em modo estrito, `tsx` para
executar scripts sem build, Vitest 5 para testes e GitHub Actions para CI
(typecheck + testes unitários a cada push e PR).

**Opções descartadas.** TypeScript 7 (porte nativo, lançado há pouco; ganho de velocidade
irrelevante neste tamanho de projeto e risco de incompatibilidade com ferramentas).

**Consequências.** Testes de integração (banco, Ollama, MCP) ficam em `test/integration`
e não rodam no CI, para o CI não depender de serviços externos.
