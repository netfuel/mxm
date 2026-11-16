# Mail admin: setup

The mail admin lives at `/admin`. It manages subscribers and campaigns. Promos go out through
Cloudflare Email Service, and every email carries a personal unsubscribe link at `/u`.

| Piece | Where |
|---|---|
| React admin (source) | `admin/` (build with `cd admin && npm install && npm run build` → `public/admin/`) |
| API | `functions/admin/api/[[path]].js`, guarded by `functions/admin/_middleware.js` |
| Unsubscribe page | `functions/u.js` |
| Shared code | `lib/mail/` (schema, Access check, email template, sender) |
| Data | Cloudflare D1 database bound as `DB` (tables are created on first request) |

Until the steps below are done, `/admin` shows "not set up yet" and stays locked.

## One-time Cloudflare setup

1. **Put your domain on Cloudflare DNS.** Email Service only works with domains on Cloudflare DNS.
   Dashboard → Add a domain, then switch the nameservers at your registrar.
2. **Workers Paid plan** ($5/month). This is required to send to subscribers. On the free plan,
   Email Service only sends to addresses you've verified yourself.
3. **Onboard the domain to Email Service** (Dashboard → Email Service). Add the SPF, DKIM and DMARC records it shows.
   Pick a From address on that domain, for example `news@yourdomain.com`.
4. **Create the database.** Workers & Pages → D1 → Create → name it `mxm-mail`. Copy the **Database ID**.
5. **Lock `/admin` with Cloudflare Access.** Zero Trust → Access → Applications → Add → Self-hosted.
   - Domain: the site's domain, path `admin`. A custom domain on Cloudflare is recommended.
   - Policy: Allow → Emails → your address. Login method: One-time PIN.
   - Copy the **Application Audience (AUD) tag**, and your **team domain** (`<team>.cloudflareaccess.com`, under Settings → Custom pages / General).
6. **Create an API token** for sending: My Profile → API Tokens → Create custom token,
   with permission Account → **Email Sending → Edit**. Copy the token and your **Account ID**.
7. **Add the secret.** Pages → mxm → Settings → Variables and Secrets → add `CF_EMAIL_TOKEN` as a **Secret** (Production).
8. In `wrangler.toml`, uncomment the mail block and fill in the D1 database ID, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`
   and `CF_ACCOUNT_ID`. Then push.
9. Open `/admin` → Settings. Fill in the From address, mailing address (required by CAN-SPAM) and test address.
   Set Site URL to your custom domain if you use one. Send a test campaign to yourself first.

## How sending works

- **Send test** sends to up to 5 addresses, with "[Test]" in the subject.
- **Send** takes a snapshot of the audience (everyone subscribed, or one tag). The open admin tab then sends in batches of 20.
  You can pause and resume. A send interrupted mid-flight is marked failed, not resent, so nobody gets a duplicate.
- Each email gets `List-Unsubscribe` and one-click unsubscribe headers. Unsubscribed people stay in the list as `unsubscribed`.
  Imports and "Add" never re-subscribe them.
- Cloudflare starts new senders on low limits. If a batch hits a rate limit, the admin waits and keeps going.
  If the daily limit is hit, it stops with the error, and you can resume the next day.

## Local development

```
printf 'DEV_NO_AUTH=1\nMAIL_DRY_RUN=1\n' > .dev.vars
npx wrangler pages dev public --d1 DB=mxm-mail-local     # API + site on :8788 (dry run: mail lands in the outbox table)
cd admin && npm run dev                                   # admin with hot reload, proxied to :8788
```
`DEV_NO_AUTH` only works on localhost.
