# Security Policy

Fanout is a small proxy with a deliberately narrow trusted surface. This file says how to report a
problem privately, what we consider in scope, and where the honest limits are.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately instead.

- Use GitHub's private advisory form: the "Report a vulnerability" button under the repository's
  Security tab. This keeps the report private until a fix is ready.

Tell us what you found, how to reproduce it, and what an attacker gains. A working proof of concept
helps but is not required. We will confirm we received the report, work the issue, and credit you
when a fix ships unless you ask us not to.

## In scope

These are the parts where a break matters, and where we want to hear from you.

### HMAC key signing

A Fanout key is an HMAC signature over its own payload, verified by recompute, with no user table
behind it (`lib/auth.ts`). A forgery that verifies is a full break. That includes minting a valid
key without the master secret, swapping the payload while keeping a valid signature, escalating a
tier from `free` to `pro`, or moving the expiry.

### AES-GCM sealed connection blobs

A provider key is sealed into an AES-256-GCM blob that the client holds; Fanout keeps no copy
(`lib/seal.ts`). Each blob is bound to the user who sealed it as AES-GCM
additional authenticated data, so it is unusable by anyone but its owner. In scope: decrypting a blob without the
encryption key, using one user's blob under another user's key, or any tampering with the IV,
ciphertext, or tag that the tag does not catch.

### The supporter relay

The `claude-code` model routes through a work queue to a supporter's machine (`lib/queue.ts`,
`api/work/*`). In scope: reading or completing a job you do not hold the capability for, forging a
completion, or breaking the isolation between the job UUID and the requester. Jobs deliberately
carry only the model and the flattened messages, with no requester id or IP, and the job UUID is
the only capability to complete it.

## Out of scope

- Denial of service through raw request volume. Rate limiting is per instance and approximate by
  design; see below.
- Anything requiring the server's environment secrets (`MASTER_SECRET`,
  `MASTER_ENCRYPTION_KEY`). If those leak, everything signed or sealed under them is void, and that
  is understood.
- Provider-side behavior once a request leaves Fanout.

## Known limits

These are consequences of the design, not bugs. We list them so a report about one is not a
surprise, and so the trust model is clear before you rely on it.

- **A leaked key is valid until it expires.** Keys carry a 90 day expiry and there is no
  revocation list, because there is no database on the hot path. A key that leaks stays good until
  it expires. Rotating the master secret invalidates every key at once, which is the only lever.
- **Rate limiting is per instance and approximate.** The limiter is a sliding window held in the
  memory of one warm instance. It resets on a cold start and does not add up across regions. It
  protects Fanout's own invocation quota against a single source. It does not stop a distributed
  caller and is not meant to.
- **The relay is a plaintext trust relationship.** A supporter answering `claude-code` requests
  reads the prompts they are handed, and the caller reads the supporter's answer. There is no
  encryption between the two and no vetting of either side. This is disclosed where a supporter
  turns the worker on. Do not send anything through the relay that you would not hand to a
  stranger.
