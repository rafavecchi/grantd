// Exercises the SDK against a running broker. Run with the broker up:
//   GRANTD_API_KEY=sk_... npx tsx sdk/test.ts
import { Grantd, AuthorizationRequiredError } from './index';

const aa = new Grantd({
  apiKey: process.env.GRANTD_API_KEY!,
  baseUrl: process.env.GRANTD_BASE_URL,
});

console.log('providers:', (await aa.listProviders()).map((p) => p.slug).join(', '));

console.log(
  'connections:',
  (await aa.listConnections()).map((c) => `${c.provider}/${c.userId}:${c.status}`).join(', '),
);

const gh = await aa.proxy<{ login: string; id: number }>({ userId: 'rafa', provider: 'github', path: '/user' });
console.log('proxy github /user ->', gh.login, gh.id);

const tok = await aa.getToken({ userId: 'rafa', provider: 'google', forceRefresh: true });
console.log('getToken google (forced refresh) -> expiresAt', tok.expiresAt, '| token length', tok.accessToken.length);

// Auth-gating: slack is not connected -> should throw AuthorizationRequiredError.
try {
  await aa.proxy({ userId: 'rafa', provider: 'slack', path: '/auth.test' });
  console.log('ERROR: expected AuthorizationRequiredError for slack');
} catch (e) {
  if (e instanceof AuthorizationRequiredError) {
    console.log(`slack -> AuthorizationRequiredError (type=${e.type}, connectUrl=${e.connectUrl ? 'present' : 'null'})`);
  } else {
    throw e;
  }
}

process.exit(0);
