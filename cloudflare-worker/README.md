# Netflix forwarded-email worker

Deploy `netflix-email-worker.js` as the Email Worker used by the Cloudflare Email Routing address that receives forwarded Outlook messages.

Required Worker variables:

- `RECEIVE_CODE_WEBHOOK_URL=https://tv-zone.vercel.app/api/receive-code`
- `RECEIVE_CODE_WEBHOOK_SECRET=<same secret configured in Vercel>`

Required Vercel variable:

- `RECEIVE_CODE_WEBHOOK_SECRET=<same secret configured in Cloudflare>`

Do not set `ACCOUNT_EMAIL_OVERRIDE` for a shared routing address. It is only intended for a route permanently dedicated to one account; otherwise it prevents automatic matching of each forwarded message to its original Outlook recipient.

The Worker sends all plausible original-recipient addresses to the Vercel endpoint. The endpoint uses the first address that matches `customer_links.email` or the related `accounts.email`, stores the code in `verification_messages`, ignores consumed messages, and removes unused messages older than 30 minutes.
