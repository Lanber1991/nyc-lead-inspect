import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function getAccessToken() {
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

function findAllPdfAttachments(parts, results = []) {
  if (!parts) return results
  for (const part of parts) {
    if (part.mimeType === 'application/pdf' && part.body?.attachmentId) {
      results.push({ attachmentId: part.body.attachmentId, filename: part.filename || '' })
    }
    if (part.parts) findAllPdfAttachments(part.parts, results)
  }
  return results
}

async function downloadAttachment(messageId, attachmentId, accessToken) {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  const data = await res.json()
  // Convert Gmail's URL-safe base64 to standard base64
  return data.data.replace(/-/g, '+').replace(/_/g, '/')
}

async function processLabEmail(messageId, accessToken) {
  const msgRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  const msg = await msgRes.json()

  const headers = msg.payload?.headers || []
  const from = headers.find(h => h.name === 'From')?.value || ''
  const subject = headers.find(h => h.name === 'Subject')?.value || ''

  const attachments = findAllPdfAttachments(msg.payload?.parts)
  if (!attachments.length) return null

  // Identify lab report vs COC by filename
  let labAttachment = null
  let cocAttachment = null

  for (const att of attachments) {
    const name = att.filename.toLowerCase()
    if (/coc|chain.of.custody|chain_of_custody/i.test(name)) {
      cocAttachment = att
    } else if (/lab|report|result|emsl|analytical/i.test(name)) {
      labAttachment = att
    }
  }

  // Fallback: if we couldn't identify by name, first = lab, second = COC
  if (!labAttachment && !cocAttachment) {
    labAttachment = attachments[0]
    if (attachments.length > 1) cocAttachment = attachments[1]
  } else if (!labAttachment) {
    labAttachment = attachments.find(a => a !== cocAttachment) || attachments[0]
  } else if (!cocAttachment) {
    cocAttachment = attachments.find(a => a !== labAttachment) || null
  }

  // Download lab PDF
  const labPdfBase64 = await downloadAttachment(messageId, labAttachment.attachmentId, accessToken)

  // Download COC PDF if present
  let cocPdfBase64 = null
  if (cocAttachment) {
    cocPdfBase64 = await downloadAttachment(messageId, cocAttachment.attachmentId, accessToken)
  }

  // Extract COC number from subject
  let cocNumber = ''
  const cocMatch = subject.match(/\b(\d{8,12})\b/)
  if (cocMatch) cocNumber = cocMatch[1]

  // Extract lab data from lab PDF
  const extractRes = await fetch('https://nyc-lead-inspect.vercel.app/api/lab-extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pdfBase64: labPdfBase64, cocNumber })
  })
  if (!extractRes.ok) return null
  const extracted = await extractRes.json()

  // Match COC number to a pending inspection
  const cocToMatch = cocNumber || extracted.cocNumber
  let inspectionId = null

  if (cocToMatch) {
    const { data: inspections } = await supabase
      .from('inspections')
      .select('id, form_data, status')
      .eq('status', 'pending')

    if (inspections) {
      for (const insp of inspections) {
        const inspCoc = insp.form_data?.cocNumber || insp.form_data?.cocNum || ''
        if (inspCoc && (inspCoc === cocToMatch || inspCoc.includes(cocToMatch) || cocToMatch.includes(inspCoc))) {
          inspectionId = insp.id
          break
        }
      }
    }
  }

  if (!inspectionId) {
    console.log(`No matching pending inspection for COC: ${cocToMatch}`)
    return { extracted, cocNumber: cocToMatch, matched: false }
  }

  // Interpret lab results
  const interpretRes = await fetch('https://nyc-lead-inspect.vercel.app/api/lab-interpret', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ samples: extracted.samples })
  })
  const interpreted = await interpretRes.json()

  // Save everything to the inspection
  const labData = {
    samples: extracted.samples,
    narrative: interpreted.narrative,
    processedAt: new Date().toISOString(),
    source: 'email',
    emailFrom: from,
    emailSubject: subject,
    cocNumber: cocToMatch,
    labPdfBase64,
    cocPdfBase64
  }

  await supabase
    .from('inspections')
    .update({ status: 'lab_received', lab_data: labData })
    .eq('id', inspectionId)

  // Auto-generate report
  try {
    await fetch('https://nyc-lead-inspect.vercel.app/api/generate-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inspectionId })
    })
  } catch (e) {
    console.error('Auto report generation failed:', e)
  }

  return { inspectionId, cocNumber: cocToMatch, matched: true }
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).end()

  // Verify cron secret when called automatically by Vercel
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.authorization
    if (auth !== `Bearer ${cronSecret}`) return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const accessToken = await getAccessToken()
    if (!accessToken) return res.status(500).json({ error: 'Could not get access token' })

    // Narrow search to EMSL lab result emails only
    const searchRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=from:emsl.com+has:attachment+newer_than:2d&maxResults=10`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    const searchData = await searchRes.json()
    const messages = searchData.messages || []

    const results = []
    for (const msg of messages) {
      const result = await processLabEmail(msg.id, accessToken)
      if (result) results.push(result)

      // Mark as read to avoid reprocessing
      await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}/modify`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ removeLabelIds: ['UNREAD'] })
        }
      )
    }

    return res.status(200).json({ processed: results.length, results })

  } catch (err) {
    console.error('Gmail webhook error:', err)
    return res.status(500).json({ error: err.message })
  }
}
