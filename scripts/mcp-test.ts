// Smoke-test the MCP server: spawn it over stdio, list tools, call a few.
// Requires the broker running on AGENTAUTH_BASE_URL and a connected user.
import 'dotenv/config';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: process.execPath, // node
  args: ['./node_modules/tsx/dist/cli.mjs', 'src/mcp.ts'],
  env: process.env as Record<string, string>,
});

const client = new Client({ name: 'mcp-test', version: '0.0.1' });
await client.connect(transport);

const tools = await client.listTools();
console.log('TOOLS:', tools.tools.map((t) => t.name).join(', '));

const show = (label: string, res: any) =>
  console.log(`\n${label}:\n  ` + (res.content?.[0]?.text ?? JSON.stringify(res)).slice(0, 400));

show('list_providers', await client.callTool({ name: 'list_providers', arguments: {} }));
show('check_connection(github, rafa)', await client.callTool({ name: 'check_connection', arguments: { provider: 'github', end_user_id: 'rafa' } }));
show('call_provider(github /user, rafa)', await client.callTool({ name: 'call_provider', arguments: { provider: 'github', path: '/user', end_user_id: 'rafa' } }));
show('check_connection(slack, rafa) [not connected]', await client.callTool({ name: 'check_connection', arguments: { provider: 'slack', end_user_id: 'rafa' } }));

await client.close();
process.exit(0);
