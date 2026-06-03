// Configure (or re-key) a provider integration without putting the secret in your shell history
// or anywhere visible. Reads CLIENT_SECRET (and optional SCOPES) from the environment.
//
//   CLIENT_SECRET='<your-client-secret>' SCOPES='https://www.googleapis.com/auth/gmail.send,https://www.googleapis.com/auth/userinfo.email' \
//     npx tsx scripts/set-integration.ts google <client_id>
//
//   CLIENT_SECRET='...' SCOPES='read:user' npx tsx scripts/set-integration.ts github <client_id>
import 'dotenv/config';

const [provider, clientId] = process.argv.slice(2);
const secret = process.env.CLIENT_SECRET;
const scopes = (process.env.SCOPES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const apiKey = process.env.AGENTAUTH_API_KEY;
const base = (process.env.AGENTAUTH_BASE_URL ?? 'http://localhost:8787').replace(/\/+$/, '');

if (!provider || !clientId || !secret || !apiKey) {
  console.error('usage: CLIENT_SECRET=... [SCOPES=a,b] npx tsx scripts/set-integration.ts <provider> <client_id>');
  process.exit(1);
}

const res = await fetch(`${base}/v1/integrations/${provider}`, {
  method: 'PUT',
  headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
  body: JSON.stringify({ client_id: clientId, client_secret: secret, scopes }),
});
console.log(res.status, await res.text());
