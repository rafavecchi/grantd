// Rotates the Postgres (Supabase) password. Generates a new password, applies it with
// ALTER USER, verifies a fresh connection works, and writes the new DATABASE_URL into .env.
// The new password is never printed. Rolls back if verification fails. Run with the broker stopped.
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';

async function main() {
  const oldUrl = process.env.DATABASE_URL;
  if (!oldUrl) throw new Error('DATABASE_URL not set in .env');
  const m = oldUrl.match(/:\/\/[^:@]+:([^@]+)@/);
  if (!m) throw new Error('could not parse the password out of DATABASE_URL');
  const oldPw = m[1]!;
  const newPw = randomBytes(24).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 28);
  const newUrl = oldUrl.replace(`:${oldPw}@`, `:${newPw}@`);
  const isLocal = /localhost|127\.0\.0\.1/.test(oldUrl);

  const admin = postgres(oldUrl, { max: 1, ssl: isLocal ? false : 'require' });
  await admin.unsafe(`ALTER USER postgres WITH PASSWORD '${newPw}'`);

  // Verify the new credentials work (retry for pooler propagation).
  let ok = false;
  for (let i = 0; i < 6 && !ok; i++) {
    try {
      const test = postgres(newUrl, { max: 1, ssl: isLocal ? false : 'require' });
      await test`select 1`;
      await test.end();
      ok = true;
    } catch {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  if (!ok) {
    await admin.unsafe(`ALTER USER postgres WITH PASSWORD '${oldPw}'`);
    await admin.end();
    console.error('New password did not verify within timeout — rolled back. .env unchanged.');
    process.exit(1);
  }

  const env = readFileSync('.env', 'utf8');
  writeFileSync('.env', env.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${newUrl}`));
  await admin.end();
  console.log('Rotated Supabase DB password and updated .env (new value not shown). Old password is now invalid.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
