# Netflix and OSN forwarded-email worker

Deploy `netflix-email-worker.js` as the Email Worker used by the Cloudflare Email Routing address that receives forwarded Outlook messages.

Required Worker variables:

- `RECEIVE_CODE_WEBHOOK_URL=https://tv-zone.vercel.app/api/receive-code`
- `RECEIVE_CODE_WEBHOOK_SECRET=<same secret configured in Vercel>`
- `ADMIN_FORWARD_EMAIL=gptzone1@gmail.com` (optional; this address is also the built-in fallback)

Required Vercel variable:

- `RECEIVE_CODE_WEBHOOK_SECRET=<same secret configured in Cloudflare>`

Do not set `ACCOUNT_EMAIL_OVERRIDE` for a shared routing address. It is only intended for a route permanently dedicated to one account; otherwise it prevents automatic matching of each forwarded message to its original Outlook recipient.

The Worker sends `service_type`, the original recipient as `accountEmail`, and the Cloudflare routing address as legacy `email`. Netflix codes continue to use `verification_messages`; OSN monthly OTP codes use `osn_codes`. The API also detects eligible OSN monthly accounts for compatibility with an older Worker that does not send `service_type`.
