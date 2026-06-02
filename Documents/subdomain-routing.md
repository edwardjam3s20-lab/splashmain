# Subdomain routing (SplashPass)

Single Next.js deployment on Vercel; three hostnames map to three experiences via `middleware.js`.

| Hostname | Experience | Implementation |
|----------|------------|----------------|
| `splashpass.site` | Customer app | Rewrite `/` → `public/index.html` |
| `operator.splashpass.site` | Operator dashboard | Rewrite `/` → `public/operator_v4.html` |
| `admin.splashpass.site` | Admin dashboard | Rewrite `/` → `app/admin/page.js` (`/admin`) |

## App directory layout

```
app/
  admin/              ← Admin dashboard (Next.js React)
    page.js
    layout.js
    splashpass-admin-intelligence.jsx
  api/
    auth/             ← Admin login + session (admin host only)
    tfa/
    data/             ← Admin data (admin host + session)
    operators/
    wash-points/
    operator/         ← Operator APIs (operator host + session)
  layout.js           ← Root layout
  page.js             ← Fallback redirect to customer static app

public/
  index.html          ← Customer PWA (served on apex domain)
  operator_v4.html    ← Operator PWA (served on operator subdomain)
  operator-ui.css
  operator-sw.js
```

## Vercel setup

1. Project → **Settings** → **Domains**
2. Add: `splashpass.site`, `operator.splashpass.site`, `admin.splashpass.site` (all same project).
3. DNS: apex + `www` → Vercel; CNAME `operator` and `admin` → `cname.vercel-dns.com` (or Vercel’s values).
4. Env: `NEXT_PUBLIC_ROOT_DOMAIN=splashpass.site`, `SESSION_SECRET`, Supabase keys.

## Auth & cookies

- **Admin**: cookie `splashpass_session` on `admin.splashpass.site` only.
- **Operator**: cookie `splashpass_operator_session` on `operator.splashpass.site` only.
- **Customer**: Supabase client auth in `index.html` (separate from admin/operator sessions).

Middleware blocks admin APIs on customer/operator hosts and operator APIs on other hosts. Route handlers still verify sessions.

## Local development

**Option A — hosts file** (`C:\Windows\System32\drivers\etc\hosts`):

```
127.0.0.1 splashpass.site
127.0.0.1 operator.splashpass.site
127.0.0.1 admin.splashpass.site
```

Run `npm run dev` and open `http://admin.splashpass.site:3000`, etc.

**Option B — localhost + env**

```bash
DEV_SITE=operator npm run dev
```

**Option C — header** (development only)

```
x-splashpass-site: admin
```
