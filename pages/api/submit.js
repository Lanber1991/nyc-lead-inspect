import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function getGmailAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  })
  const data = await res.json()
  return data.access_token
}

async function sendEmailSummary(inspection, formData) {
  try {
    const accessToken = await getGmailAccessToken()
    if (!accessToken) return

    const fd = formData || {}
    const areas = fd.affectedAreas || []
    const airSamples = fd.airSamples || []

    const emailBody = `
<!DOCTYPE html>
<html>
<head><style>
  body { font-family: system-ui, sans-serif; font-size: 14px; color: #1a1a1a; max-width: 600px; margin: 0 auto; padding: 20px; }
  .header { background: #0E2A50; color: white; padding: 20px 24px; border-radius: 8px 8px 0 0; }
  .header h2 { margin: 0; font-size: 18px; }
  .header p { margin: 4px 0 0; font-size: 12px; color: #93C5FD; }
  .section { background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 0 0 8px 8px; padding: 20px 24px; }
  .field { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #F1F5F9; font-size: 13px; }
  .field:last-child { border-bottom: none; }
  .label { color: #64748B; font-weight: 500; }
  .value { color: #0F172A; text-align: right; max-width: 60%; }
  .section-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #94A3B8; margin: 16px 0 8px; }
  .area-card { background: white; border: 1px solid #E2E8F0; border-radius: 6px; padding: 10px 14px; margin-bottom: 8px; font-size: 12px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 500; }
  .high { background: #FEE2E2; color: #991B1B; }
  .moderate { background: #FEF3C7; color: #92400E; }
  .low { background: #DCFCE7; color: #166534; }
  .footer { margin-top: 16px; font-size: 11px; color: #94A3B8; text-align: center; }
</style></head>
<body>
  <div class="header">
    <h2>New Inspection Submitted</h2>
    <p>Report #${inspection.report_number} · ${new Date().toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}</p>
  </div>
  <div class="section">
    <div class="section-title">Property & Client</div>
    <div class="field"><span class="label">Address</span><span class="value">${inspection.property_address}, ${inspection.property_city} ${inspection.property_state_zip}</span></div>
    <div class="field"><span class="label">Client</span><span class="value">${inspection.client_name || '—'}</span></div>
    <div class="field"><span class="label">Purpose</span><span class="value">${inspection.purpose || '—'}</span></div>
    <div class="field"><span class="label">Property Type</span><span class="value">${fd.propType || '—'}</span></div>

    <div class="section-title">Inspector</div>
    <div class="field"><span class="label">Name</span><span class="value">${inspection.inspector_name}</span></div>
    <div class="field"><span class="label">Date & Time</span><span class="value">${inspection.inspection_date} ${fd.inspTime || ''}</span></div>
    <div class="field"><span class="label">COC #</span><span class="value">${fd.cocNumber || '—'}</span></div>
    <div class="field"><span class="label">Overall Risk</span><span class="value">${fd.riskLevel || '—'}</span></div>

    ${areas.length > 0 ? `
    <div class="section-title">Affected Areas (${areas.length})</div>
    ${areas.map(a => `
      <div class="area-card">
        <strong>${a.room || 'Area'}${a.detail ? ' — ' + a.detail : ''}</strong>
        <span class="badge ${a.severity?.toLowerCase().includes('high') ? 'high' : a.severity?.toLowerCase().includes('moderate') ? 'moderate' : 'low'}" style="margin-left:8px">${a.severity || '—'}</span>
        <div style="margin-top:4px;color:#64748B">MC: ${a.mc || '—'}% · Source: ${a.source || '—'} · Sample: ${Array.isArray(a.sample) ? a.sample.join(', ') : (a.sample || '—')}</div>
      </div>`).join('')}
    ` : ''}

    ${airSamples.length > 0 ? `
    <div class="section-title">Air Samples (${airSamples.length})</div>
    ${airSamples.map(s => `
      <div class="field"><span class="label">${s.label || 'Sample'}</span><span class="value">${s.type || ''} · ${s.location || ''}</span></div>
    `).join('')}
    ` : ''}

    <div class="section-title">HVAC</div>
    <div class="field"><span class="label">Type</span><span class="value">${fd.hvacType || '—'}</span></div>
    <div class="field"><span class="label">Filter Condition</span><span class="value">${fd.filterCond || '—'}</span></div>
    <div class="field"><span class="label">Duct Condition</span><span class="value">${fd.ductCond || '—'}</span></div>
  </div>
  <div class="footer">
    NYC Lead Inspections · 208 Meserole Street Brooklyn NY 11206 · (646) 496-7039<br>
    This is an automated backup copy of inspection data submitted via the IAQ Field Form.
  </div>
</body>
</html>`

    // Encode email as base64 RFC 2822 format
    const emailLines = [
      `From: reports@mindfulsolutionsny.com`,
      `To: reports@mindfulsolutionsny.com`,
      `Subject: New Inspection: ${inspection.report_number} — ${inspection.property_address}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/html; charset=utf-8`,
      ``,
      emailBody
    ].join('\r\n')

    const encoded = Buffer.from(emailLines).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

    await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ raw: encoded })
    })

  } catch(err) {
    console.error('Email send error:', err)
    // Don't fail the submission if email fails
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const {
    report_number, inspector_name, property_address, property_city,
    property_state_zip, client_name, inspection_date, purpose,
    form_data
  } = req.body

  if (!report_number || !form_data) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  const { data, error } = await supabase
    .from('inspections')
    .insert([{
      report_number,
      inspector_name,
      property_address,
      property_city,
      property_state_zip,
      client_name,
      inspection_date,
      purpose,
      status: 'pending',
      form_data,
      submitted_at: new Date().toISOString()
    }])
    .select()
    .single()

  if (error) {
    console.error('Supabase error:', error)
    return res.status(500).json({ error: error.message })
  }

  // Send email backup — non-blocking
  sendEmailSummary({ report_number, inspector_name, property_address, property_city, property_state_zip, client_name, inspection_date, purpose }, form_data)

  return res.status(200).json({ success: true, id: data.id, report_number: data.report_number })
}

export const config = {
  api: { bodyParser: { sizeLimit: '25mb' } }
}
