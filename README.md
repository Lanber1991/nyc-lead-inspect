# Mindful Solutions NY — IAQ Dashboard

## Setup (one time)

### 1. Create the database table in Supabase
1. Go to supabase.com → your project → SQL Editor
2. Paste the contents of `supabase-schema.sql` and click Run

### 2. Deploy to Vercel
1. Go to vercel.com → Add New → Project
2. Choose "Deploy from template" → select "Next.js"
   OR upload this folder directly using Vercel CLI:
   ```
   npm i -g vercel
   cd mindful-iaq
   vercel
   ```
3. When prompted for environment variables, add:
   - NEXT_PUBLIC_SUPABASE_URL = https://vkgxqdtjqtlnouzayzdc.supabase.co
   - NEXT_PUBLIC_SUPABASE_ANON_KEY = (your anon key)

### 3. Get your dashboard URL
After deploying, Vercel gives you a URL like:
`https://mindful-iaq.vercel.app`

### 4. Enter the URL in the form
Open iaq_final.html → go to the last screen (Review & Submit)
Paste your Vercel URL into the "Dashboard URL" field.
The form will save it for next time.

## How it works

**Inspector (in the field):**
- Fills out iaq_final.html on their phone
- Hits "Submit Inspection →"  
- Inspection appears in dashboard as "Pending Lab Results"

**You (back at the office):**
- Open dashboard at your Vercel URL
- See all pending inspections
- When EMSL results arrive, click "Open & Generate Report"
- Upload EMSL PDF → Claude extracts and interprets results
- Generate final PDF report

## Pages
- `/` — Dashboard (all inspections)
- `/inspection/[id]` — Single inspection detail
- `/form` — The inspection form (copy iaq_final.html here or link to it)
