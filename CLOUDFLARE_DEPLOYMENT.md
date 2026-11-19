# Cloudflare Workers deployment

This app is set up to run as a Cloudflare Worker using Cloudflare's `vinext` integration. It remains a Next.js app; the existing Next.js/Vercel scripts are preserved. The Worker name is `carrybee-lead-crm`.

## Current setup

- `vinext check` reported 96% compatibility, with no blocking issues (one partial item: React Strict Mode behavior).
- `npm run build:vinext` succeeds locally.
- Shared caching and image optimization are disabled intentionally: this CRM serves authenticated, sensitive records and currently does not use `next/image`.

## Prerequisites

- Node.js 22.23+, 24.22+, or 26.12+ (the supported `cf` CLI lines; the existing Vercel project is configured for Node 26.x).
- A Cloudflare account authorized for Workers.
- The production Supabase URL and anon key available at build time, and the server-only Supabase key plus `CRON_SECRET` available as Worker secrets.

Provide `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to the build through the environment or an ignored local `.env.local` file. Configure them in the build environment for CI or other machines. They are public application configuration, not server secrets; never commit `.env.local`.

## Deploy

From this repository root, after authenticating to the intended Cloudflare account:

```sh
npx cf auth login
npx cf auth whoami
npm run build:vinext
npm run deploy:vinext
```

`npm run deploy:vinext` performs the validated vinext build/deploy flow. The Worker will use the default `workers.dev` hostname unless a custom domain is configured separately.

## Required runtime secrets

Set these as encrypted Worker secrets in Cloudflare, never as plain vars in source control or `cloudflare.config.ts`:

- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET`

Set the values from your existing secret manager directly in Cloudflare's Worker settings, or use Cloudflare's secret-management CLI. Do not paste secrets into chat or commit them. The CRM's Apps Script backup caller must keep using the same `CRON_SECRET`; changing it requires updating the matching Apps Script property too.

After the first deployment, set these secrets, then add the Worker URL (including `/auth/callback`) to the Supabase Auth redirect allowlist before testing sign-in. Do not change production DNS or disable the existing Vercel deployment until Cloudflare sign-in, lead reads/writes, and backup routes have been verified.

## Verification and limitations

```sh
npm run lint
npm run build:vinext
```

`npm run lint` and `npm run build:vinext` both pass. The compatibility scan had one partial item (App Router React Strict Mode is not currently wrapped by vinext); no blocking issues were reported. `npm run deploy:vinext -- --dry-run` also validates the setup without publishing.

`npm audit` still reports one high-severity PostCSS advisory through the retained Next.js 15 dependency; the available fix requires a Next.js major upgrade, so I did not change the existing Next/Vercel runtime as part of this Cloudflare setup.
