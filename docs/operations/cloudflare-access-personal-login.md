# Cloudflare Access Personal Login

This project uses Cloudflare Access as the login boundary for personal use.

## Target

- No D1 user table.
- No project-owned password storage.
- One allowed owner email.
- Access blocks Pages and Worker requests before they reach the app.
- Workers also validate the Access JWT when `ACCESS_JWT_REQUIRED=true`.

## Cloudflare Zero Trust setup

1. Create a self-hosted Access application for `bitcoin.feiniwork.com/*`.
2. Add an Allow policy for the owner email only.
3. Enable MFA or one-time PIN for the identity provider. Prefer passkey or hardware-key MFA when available.
4. Create matching self-hosted Access applications for direct API surfaces:
   - `btc.feiniwork.com/*`
   - `yuqing.feiniwork.com/*`
   - Any active `*.workers.dev` route that remains enabled.
   - Any active `*.pages.dev` production or preview URL that should not be public.
5. For API applications, configure CORS in Access to match the Worker response:
   - Allow origin: `https://bitcoin.feiniwork.com`
   - Allow credentials: enabled
   - Allow methods: `GET, POST, PUT, DELETE, OPTIONS, HEAD`
   - Allow headers: `Content-Type, Accept, Cf-Access-Jwt-Assertion`
   - Either bypass OPTIONS requests to origin or configure Access to answer preflight with the same headers.

## Worker variables

Set these on both the `btc` and `yuqing` Workers after the Access applications exist:

- `ACCESS_TEAM_DOMAIN`: `<your-team>.cloudflareaccess.com`
- `ACCESS_AUD`: the Access application AUD tag for that Worker hostname
- `ACCESS_ALLOWED_EMAILS`: the owner email
- `ACCESS_ALLOWED_ORIGINS`: `https://bitcoin.feiniwork.com`
- `ACCESS_JWT_REQUIRED`: `true`

For `yuqing` calling the protected `btc` Worker, add a Cloudflare Access service token and store it as encrypted Worker secrets:

- `ACCESS_SERVICE_CLIENT_ID`
- `ACCESS_SERVICE_CLIENT_SECRET`

Add a Service Auth policy for that token on the `btc` Access application.

## Verification

- Unauthenticated browser access to `https://bitcoin.feiniwork.com/` redirects to Cloudflare Access.
- Authenticated owner email can load each hash route.
- Direct requests to `https://btc.feiniwork.com/api/d1/status` without Access fail.
- Direct requests to `https://yuqing.feiniwork.com/api/yuqing/health` without Access fail.
- After login, the frontend can read D1/chart/orderflow/yuqing data.
- Worker logs show no missing `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, or service token errors.
