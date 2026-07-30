<!-- Keep it short and plain. No em dashes. -->

## What this changes

Describe the change in a sentence or two, and link the issue it closes (for example: Closes #49).

## Why

What problem this solves or what it adds.

## Checklist

- [ ] `npm run check` passes locally
- [ ] `npm run test:e2e` passes (if the request path or relay was touched)
- [ ] Added or updated assertions for new behavior
- [ ] Respects the architecture invariants in `CLAUDE.md` (no database on the hot path, AES-GCM
      owner-binding kept, zero runtime deps in `lib/` and `api/`, strict CSP on HTML pages, Edge
      runtime, WebCrypto only)
- [ ] Updated `PROJECT.md` if this change belongs on the board
- [ ] Scoped to one issue, no unrelated refactors
