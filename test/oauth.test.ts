import { describe, it, expect } from 'vitest';
import { parseTokenResponse, resolveTemplate } from '../src/oauth';
import { getProvider } from '../src/providers';

describe('resolveTemplate', () => {
  it('substitutes connectionConfig placeholders', () => {
    expect(
      resolveTemplate('https://api.example.com/${connectionConfig.subdomain}/v1', { subdomain: 'acme' }),
    ).toBe('https://api.example.com/acme/v1');
  });
  it('leaves a non-templated url unchanged', () => {
    expect(resolveTemplate('https://api.github.com', {})).toBe('https://api.github.com');
  });
  it('replaces a missing var with empty string', () => {
    expect(resolveTemplate('https://${connectionConfig.x}.example.com', {})).toBe('https://.example.com');
  });
});

const google = getProvider('google');
const slack = getProvider('slack');

describe('parseTokenResponse', () => {
  it('parses a standard OAuth2 response', () => {
    const t = parseTokenResponse(google, {
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: 3600,
      scope: 'a b',
    });
    expect(t.accessToken).toBe('at');
    expect(t.refreshToken).toBe('rt');
    expect(t.scopes).toEqual(['a', 'b']);
    expect(t.expiresAt).toBeInstanceOf(Date);
  });

  it('prefers Slack nested authed_user token + scope', () => {
    const t = parseTokenResponse(slack, {
      access_token: 'xoxb-bot',
      scope: 'bot:scope',
      authed_user: { access_token: 'xoxp-user', scope: 'chat:write,users:read' },
    });
    expect(t.accessToken).toBe('xoxp-user');
    expect(t.scopes).toEqual(['chat:write', 'users:read']);
  });

  it('falls back to the top-level Slack bot token when no user token is present', () => {
    const t = parseTokenResponse(slack, { access_token: 'xoxb-bot', scope: 'bot:scope' });
    expect(t.accessToken).toBe('xoxb-bot');
    expect(t.scopes).toEqual(['bot:scope']);
  });

  it('throws when no access token can be found', () => {
    expect(() => parseTokenResponse(google, { scope: 'a' })).toThrow(/no access_token/);
  });
});
