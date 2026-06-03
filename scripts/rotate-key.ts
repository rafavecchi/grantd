// Rotates the Grantd secret key (sk_). Issues a new key, updates the api_keys row in the DB,
// and writes the new key into .env (GRANTD_API_KEY). The new key is never printed. The old
// key is invalidated immediately.
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { sql } from '../src/db';
import { generateApiKey, hashApiKey } from '../src/crypto';

async function main() {
  const current = process.env.GRANTD_API_KEY;
  if (!current) throw new Error('GRANTD_API_KEY not set in .env');

  const rows = await sql<{ id: string }[]>`
    select id from api_keys where key_hash = ${hashApiKey(current)} and type = 'secret' limit 1`;
  const row = rows[0];
  if (!row) throw new Error('current secret key not found in DB (already rotated?)');

  const { key, keyPrefix, keyHash } = generateApiKey('sk');
  await sql`update api_keys set key_hash = ${keyHash}, key_prefix = ${keyPrefix}, last_used_at = null where id = ${row.id}`;

  const env = readFileSync('.env', 'utf8');
  writeFileSync('.env', env.replace(/^GRANTD_API_KEY=.*$/m, `GRANTD_API_KEY=${key}`));

  console.log(`Rotated Grantd secret key (new prefix ${keyPrefix}…, written to .env, not shown). Old key is now invalid.`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
