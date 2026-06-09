# Hosted deployment checklist

The open-source single-tenant broker is safe to self-host for your own agents. The moment you run a
**hosted, multi-tenant service that custodies other people's OAuth tokens**, you become a high-value
target and a data custodian. This checklist is the bar to clear *before* the first external user's
token lands in your database. Don't skip items — each maps to a concrete way you'd get hurt.

Status legend: `[ ]` not done · `[x]` done · `[~]` partial / in progress.

## 1. Secret & key custody (highest priority)

The encryption keyring + database URL together can decrypt every token. Treat them accordingly.

- [ ] Move `ENCRYPTION_KEYRING` and `DATABASE_URL` out of `.env` files into a managed secrets store
      (AWS Secrets Manager / GCP Secret Manager / Vault). No long-lived secrets on disk.
- [ ] Encrypt the keyring with a cloud KMS (envelope-of-envelope): the KMS holds the root key, the
      app fetches a decrypted data key at boot, never persisting it.
- [ ] Restrict secret access by IAM to the broker's runtime identity only; audit every read.
- [ ] Document and rehearse **key rotation**: add a new `kid`, flip `ENCRYPTION_ACTIVE_KID`, confirm
      old rows still decrypt, then retire the old key after re-encryption.
- [ ] Have a **key-loss runbook** (losing the keyring = every token must be re-authorized).

## 2. Secret-key (`sk_`) lifecycle

`sk_` keys are bearer tokens with full access to an environment's connections.

- [ ] Support key **rotation** (issue new, deprecate old) without downtime.
- [ ] Support key **expiry** and immediate **revocation**.
- [ ] Consider **scoped keys** (read-only, per-provider, per-end-user) to limit blast radius.
- [ ] Alert on a key used from a new IP/ASN or at anomalous rate.

## 3. Network & edge

- [ ] Terminate **TLS** everywhere; HSTS; no plaintext broker port exposed.
- [ ] Put a **WAF / edge (e.g. Cloudflare)** in front for volumetric DoS — the in-process limiter
      still has to accept each request, so it is not volumetric protection on its own.
- [ ] Ensure `x-forwarded-for` is set by *your* trusted proxy and not spoofable (per-IP limits depend
      on it).
- [ ] Lock egress: the proxy follows provider redirects — pin/allowlist provider base URLs and block
      requests to internal/metadata addresses (SSRF hardening).

## 4. Database

- [x] **Row-Level Security enabled on all tables** (verified on the live DB).
- [ ] Broker connects as a least-privilege role (not the Postgres superuser); no DDL at runtime.
- [ ] Network-restrict the database to the broker (private networking / IP allowlist), not the public
      internet.
- [ ] Encrypted backups with tested restore; backups inherit the same key-custody rules.
- [ ] Point-in-time recovery enabled.

## 5. Observability & incident response

- [ ] **Audit log** of every token use, connect, refresh, and admin action (who, when, which end-user).
- [ ] **Alerting** on anomalies: spikes in 401/403, refresh failures, decrypt failures, rate-limit hits.
- [ ] Centralized logs with **no secrets/tokens** ever logged (scrub on the way in).
- [ ] A written **incident-response + breach-notification** plan (who you tell, how fast).
- [ ] A **revocation path**: invalidate a compromised connection and force re-auth quickly.

## 6. Application hardening

- [ ] Pin and regularly `npm audit` dependencies; automate (Dependabot/Renovate).
- [ ] CSRF protection on the hosted Connect UI; tight `state` validation already in place — keep it.
- [ ] Short-lived Connect UI session tokens (already random + single-purpose); add expiry/one-time use.
- [ ] Security headers on the Connect UI (CSP, X-Frame-Options, etc.).
- [ ] Rate-limit the connect/callback flows per end-user, not just per IP.

## 7. Compliance & trust (as you take real customers)

- [ ] Privacy policy + terms; clear data-retention and deletion guarantees.
- [ ] A user-facing **disconnect / delete-my-data** path that actually purges vaulted tokens.
- [ ] Decide on **SOC 2** / a third-party **penetration test** before enterprise customers ask.
- [ ] Sign **DPAs** with sub-processors (your host, Postgres provider, etc.).

---

**Current posture:** single-tenant, self-hosted, holding only the operator's own tokens. RLS on,
dependencies clean, no secrets in the repo, honest docs. That is appropriate for launch as
open-source infrastructure. This checklist is the gate for the *hosted* product — not a prerequisite
for shipping the code.
