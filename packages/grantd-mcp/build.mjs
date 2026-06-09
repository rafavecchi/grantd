// Bundle the Grantd MCP server (src/mcp.ts) into a single self-contained,
// dependency-free executable so `npx grantd-mcp` is fast and reliable.
import { build } from 'esbuild';
import { chmodSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, '../../src/mcp.ts');
const outfile = resolve(here, 'dist/index.cjs');

mkdirSync(resolve(here, 'dist'), { recursive: true });

await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  // CommonJS so bundled deps that use dynamic require() work at runtime.
  format: 'cjs',
  target: 'node18',
  outfile,
  banner: { js: '#!/usr/bin/env node' },
  // Bundle all deps (mcp sdk, zod, dotenv) so the published package has none.
  legalComments: 'none',
});

chmodSync(outfile, 0o755);
console.log('built', outfile);
