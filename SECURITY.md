# Security

Grantd vaults users' OAuth tokens, so security is the product. This document describes the model,
what you're responsible for when self-hosting, current limitations, and how to report issues.

## Model

- **Tokens are encrypted at rest** with AES-256-GCM envelope encryption. Each ciphertext is
  self-describing (`v1:<key-id>:<iv>:<tag>:<ciphertext>`) with a fresh 12-byte IV per record. Key
  rotation is supported by adding a new key id and flipping the active key — old rows keep
  decrypting under their original key. If the active key is missing, encryption fails closed (it
  never silently stores plaintext).
- **Tokens never reach the LLM.** The proxy injects the access token at the network boundary and
  returns the provider's response; the raw token is not returned to the caller on the proxy path.
- **API keys are hashed at rest** (pbkdf2-sha256, peppered with `API_KEY_SALT`); the raw key is
  shown once at creation.
- **Tenant isolation.** Every query, connection, and lookup is scoped by environment id.
- **OAuth state and session tokens** are 256-bit random values; PKCE (S256) is used where the
  provider supports it.

## Self-hosting responsibilities

- Generate a strong `ENCRYPTION_KEYRING` (32-byte, base64) with `npm run keygen`, keep it secret,
  and back it up — losing it means every vaulted token must be re-authorized.
- Lock down the database. If you use Postgres' auto-exposed REST layer (e.g. Supabase/PostgREST),
  **enable Row Level Security on all tables** — Grantd connects directly as a privileged role and
  does not need RLS to function, so enabling RLS with no policies closes the REST attack surface.
- Run the broker behind TLS. The broker trusts any caller presenting a valid secret key; treat
  `sk_` keys like passwords.

## Known limitations (as of this version)

- **No built-in rate limiting.** Put the broker behind a gateway/WAF that rate-limits, especially
  the public `/connect` and `/v1/connect/callback` routes.
- **The proxy follows provider redirects** (the default `fetch` behavior). Callers already need a
  valid secret key and an active connection, and the base URL is fixed per provider, but be aware
  of this if you add providers.
- **No SOC 2 / formal compliance** is claimed. This is open-source infrastructure you run yourself.

## Reporting a vulnerability

Please **do not open a public issue** for security vulnerabilities. Email the maintainer at
`security@<your-domain>` (replace with your contact) with details and a way to reproduce. We aim to
acknowledge within a few business days and will credit reporters who follow responsible disclosure.
