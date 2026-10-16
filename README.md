# Queueline

Hosted waitlists with email capture, live positions and referral links that move people up the line. Free, no account: each waitlist gets a hosted page, a one-line embed and a private admin link.

- Live: https://queueline-rouge.vercel.app
- Embed: `<script src="https://queueline-rouge.vercel.app/embed.js" data-waitlist="ID" async></script>`
- Storage: Vercel Blob (private), one JSON ledger per waitlist with ETag-conditional writes. Local dev uses `STORE_DRIVER=fs`.
- Tests: `npm test` (unit), `npm run test:integration` (HTTP API; `QL_BASE_URL`, `QL_TEST_KEY`), `npm run test:e2e` (Playwright).
See ../NOTES.md for design, test results and limits.
