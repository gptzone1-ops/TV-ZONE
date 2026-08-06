# Netflix forwarded-email worker

Deploy `netflix-email-worker.js` as the Email Worker used by the Cloudflare Email Routing address that receives forwarded Outlook messages.

Required Worker variables:

- `RECEIVE_CODE_WEBHOOK_URL=https://tv-zone.vercel.app/api/receive-code`
- `RECEIVE_CODE_WEBHOOK_SECRET=<same secret configured in Vercel>`

Required Vercel variable:

- `RECEIVE_CODE_WEBHOOK_SECRET=<same secret configured in Cloudflare>`

Do not set `ACCOUNT_EMAIL_OVERRIDE` for a shared routing address. It is only intended for a route permanently dedicated to one account; otherwise it prevents automatic matching of each forwarded message to its original Outlook recipient.

The Worker sends the original Outlook recipient as `accountEmail` and the Cloudflare routing address as legacy `email`. New payloads are matched strictly by `accountEmail`. If an older Worker does not send `accountEmail`, the endpoint preserves the legacy `email` and candidate fallback. Codes are stored in `verification_messages`; consumed messages are ignored and unused messages older than 30 minutes are removed.
