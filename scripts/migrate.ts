// Minimal SQL migration runner: applies migrations/*.sql in order, once each, in a transaction.
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sql } from '../src/db';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');

async function main() {
  await sql`create table if not exists _migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`;

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const done = await sql`select 1 from _migrations where name = ${file}`;
    if (done.length) {
      console.log(`skip   ${file}`);
      continue;
    }
    const text = await readFile(join(migrationsDir, file), 'utf8');
    console.log(`apply  ${file}`);
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`insert into _migrations (name) values (${file})`;
    });
  }
  console.log('migrations complete');
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
