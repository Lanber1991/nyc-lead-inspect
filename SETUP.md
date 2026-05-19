# NYC Lead Inspections — Setup Guide

This app is built with Next.js, Supabase, Vercel, and the Anthropic (Claude) API.
Follow these steps to get your own fully independent deployment running.

---

## 1. Prerequisites

Install the following on your machine:
- [Node.js](https://nodejs.org) (v18 or later)
- [Git](https://git-scm.com)
- [VS Code](https://code.visualstudio.com)
- [Vercel CLI](https://vercel.com/docs/cli): `npm install -g vercel`
- Claude Code VS Code extension (install from the VS Code marketplace)

---

## 2. Supabase — Create Your Database

1. Go to [supabase.com](https://supabase.com) and create a free account
2. Click **New Project** — choose a name (e.g. `nyc-lead-inspect`) and set a database password
3. Once the project is ready, go to **SQL Editor**
4. Open the file `supabase-schema.sql` from this repo and paste the entire contents into the editor
5. Click **Run** — this creates the `inspections` table
6. Go to **Settings → API** and copy:
   - **Project URL** → this is `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public key** → this is `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role secret key** → this is `SUPABASE_SERVICE_ROLE_KEY`

---

## 3. Anthropic API Key

1. Go to [console.anthropic.com](https://console.anthropic.com) and create an account
2. Go to **API Keys** and create a new key
3. Copy the key — this is `ANTHROPIC_API_KEY`

---

## 4. Gmail (for sending reports by email) — Optional

If you want the app to email completed reports:

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project → Enable the **Gmail API**
3. Create **OAuth 2.0 credentials** (Desktop app)
4. Copy the **Client ID** → `GMAIL_CLIENT_ID`
5. Copy the **Client Secret** → `GMAIL_CLIENT_SECRET`
6. Run the OAuth flow to get a **Refresh Token** → `GMAIL_REFRESH_TOKEN`

If you skip this step, the app still works — reports just won't be emailed automatically.

---

## 5. Deploy to Vercel

1. Go to [vercel.com](https://vercel.com) and create a free account
2. Push this repo to GitHub (see step 6 below)
3. In Vercel, click **Add New Project** → import your GitHub repo
4. Before deploying, go to **Environment Variables** and add all of the following:

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | From Supabase Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | From Supabase Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | From Supabase Settings → API |
| `ANTHROPIC_API_KEY` | From Anthropic Console |
| `GMAIL_CLIENT_ID` | From Google Cloud (optional) |
| `GMAIL_CLIENT_SECRET` | From Google Cloud (optional) |
| `GMAIL_REFRESH_TOKEN` | From Google Cloud OAuth flow (optional) |
| `CRON_SECRET` | Any random string, e.g. `mysecret123` |

5. Click **Deploy** — Vercel will build and publish the app

---

## 6. Push to GitHub

From inside this project folder in your terminal:

```bash
git init
git add .
git commit -m "Initial commit — NYC Lead Inspections"
```

Then create a new repo on [github.com](https://github.com) and follow the instructions to push.

---

## 7. Local Development

```bash
npm install
```

Create a `.env.local` file in the project root with all the environment variables from step 5, then run:

```bash
npm run dev
```

The app will be available at `http://localhost:3000`.

---

## 8. Using Claude Code in VS Code

1. Install the **Claude Code** extension from the VS Code marketplace
2. Open this project folder in VS Code
3. Sign in with your Anthropic account
4. You can now ask Claude to make changes to the app directly from within VS Code

---

## Branding & Customization

- **Logo**: Replace `public/logo.png` with your company logo
- **Inspector licenses**: Add inspector license PDFs or JPGs to `public/certs/` — filename must match the inspector's name in lowercase with hyphens (e.g. `john-smith.pdf`)
- **Contact info**: Search for `208 Meserole Street` or `(646) 496-7039` throughout the codebase and update to your own address and phone number
- **Colors**: The primary dark blue `#0E2A50` appears throughout `generate-report.js` and `generate-work-plan.js` — update to your brand color if needed
