// Creates a project + dev environment + API keys, and prints the secret key once.
// Usage: npm run bootstrap -- "My Project"
import { sql } from '../src/db';
import { generateApiKey } from '../src/crypto';

async function main() {
  const name = process.argv[2] ?? 'My Project';

  const projects = await sql<{ id: string }[]>`insert into projects (name) values (${name}) returning id`;
  const project = projects[0]!;
  const envs = await sql<{ id: string }[]>`
    insert into environments (project_id, name) values (${project.id}, 'dev') returning id`;
  const env = envs[0]!;

  const sk = generateApiKey('sk');
  const pk = generateApiKey('pk');
  await sql`
    insert into api_keys (environment_id, type, key_hash, key_prefix) values
      (${env.id}, 'secret', ${sk.keyHash}, ${sk.keyPrefix}),
      (${env.id}, 'publishable', ${pk.keyHash}, ${pk.keyPrefix})`;

  console.log('Project:           ', project.id, `(${name})`);
  console.log('Environment (dev): ', env.id);
  console.log('');
  console.log('SECRET KEY (shown once — save it):', sk.key);
  console.log('PUBLISHABLE KEY:                  ', pk.key);
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
