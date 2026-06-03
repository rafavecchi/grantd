import postgres from 'postgres';
import { config } from './config';

if (!config.databaseUrl) {
  throw new Error('DATABASE_URL is required to connect to the database');
}

const isLocal = /localhost|127\.0\.0\.1/.test(config.databaseUrl);

export const sql = postgres(config.databaseUrl, {
  max: 10,
  idle_timeout: 20,
  // Supabase (and most managed Postgres) require TLS; local dev usually doesn't.
  ssl: isLocal ? false : 'require',
});
