import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * H3, passo 5 (docs/h3-protocolo.md): um segundo cliente MCP, diferente do host do projeto.
 * Não importa nada de src/: só o SDK oficial. Sobe o servidor como um aplicativo qualquer o
 * subiria (comando + variáveis de ambiente), lista as tools e chama cada uma com a mesma
 * consulta. Imprime um JSON com o que encontrou.
 *
 * Uso: npx tsx scripts/h3-segundo-cliente.ts "<consulta>" [MCP_EMBEDDER=hash MCP_STORE=memory ...]
 */
const [query = 'prazo de primeira resposta a incidente SEV1', ...envArgs] = process.argv.slice(2);
const env = Object.fromEntries(envArgs.map((a) => a.split('=') as [string, string]));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['--import', 'tsx', 'src/mcp/stdio.ts'],
  env: { ...(process.env as Record<string, string>), ...env },
  stderr: 'ignore',
});
const client = new Client({ name: 'segundo-cliente-h3', version: '1.0.0' });
await client.connect(transport);
const server = client.getServerVersion();
const { tools } = await client.listTools();
const calls = [];
for (const t of tools) {
  const res = await client.callTool({ name: t.name, arguments: { consulta: query, k: 3 } });
  const out = res.structuredContent as { resultados?: { unitId: string; source: string }[] } | undefined;
  calls.push({ tool: t.name, erro: res.isError ?? false, resultados: out?.resultados?.map((r) => r.unitId) ?? [] });
}
await client.close();
console.log(JSON.stringify({ cliente: 'segundo-cliente-h3 (só o SDK oficial)', servidor: server, consulta: query, tools: tools.map((t) => ({ nome: t.name, titulo: t.title, descricao: t.description })), chamadas: calls }, null, 2));
