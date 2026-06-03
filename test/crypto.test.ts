import { describe, it, expect } from 'vitest';
import {
  encrypt,
  decrypt,
  encryptJSON,
  decryptJSON,
  generateApiKey,
  hashApiKey,
  safeEqual,
} from '../src/crypto';

describe('envelope encryption', () => {
  it('round-trips plaintext', () => {
    const ct = encrypt('hello world');
    expect(ct).toMatch(/^v1:1:/); // version + active key id
    expect(decrypt(ct)).toBe('hello world');
  });

  it('round-trips JSON credentials', () => {
    const creds = { access_token: 'abc', refresh_token: 'def', n: 1 };
    expect(decryptJSON(encryptJSON(creds))).toEqual(creds);
  });

  it('uses a fresh IV each time (same plaintext -> different ciphertext)', () => {
    expect(encrypt('same')).not.toBe(encrypt('same'));
  });

  it('rejects tampered ciphertext (GCM auth tag)', () => {
    const ct = encrypt('secret');
    const parts = ct.split(':');
    const seg = parts[4]!;
    parts[4] = seg.slice(0, -1) + (seg.endsWith('A') ? 'B' : 'A');
    expect(() => decrypt(parts.join(':'))).toThrow();
  });

  it('rejects an unknown key id', () => {
    const ct = encrypt('secret').split(':');
    ct[1] = '999';
    expect(() => decrypt(ct.join(':'))).toThrow(/unknown encryption key id/);
  });
});

describe('api keys', () => {
  it('generates a prefixed key whose hash verifies deterministically', () => {
    const { key, keyPrefix, keyHash } = generateApiKey('sk');
    expect(key.startsWith('sk_')).toBe(true);
    expect(keyPrefix.startsWith('sk_')).toBe(true);
    expect(hashApiKey(key)).toBe(keyHash); // stable hash for lookup
    expect(safeEqual(hashApiKey(key), keyHash)).toBe(true);
  });

  it('different keys produce different hashes', () => {
    expect(generateApiKey('sk').keyHash).not.toBe(generateApiKey('sk').keyHash);
  });
});
