export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { pdfBase64, cocNumber } = req.body
  if (!pdfBase64) return res.status(400).json({ error: 'No PDF provided' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' })

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
            { type: 'text', text: `This is an EMSL laboratory report. Extract the report metadata and all sample results.

Return a single JSON object with this structure:
{
  "order_number": "EMSL order/COC number (e.g. 032605317)",
  "project_address": "full property address listed on the report (e.g. 200 East 15th Street #8D New York NY 10003)",
  "samples": [
    {
      "sample_id": "lab sample ID",
      "sample_type": "air", "tape_lift", or "bulk",
      "location": "location or description if listed",
      "results": [{ "species": "...", "count": "...", "unit": "...", "notes": "..." }],
      "outdoor_control": true if this is an outdoor/control sample,
      "raw_summary": "one line summary of what was found"
    }
  ]
}

Return ONLY the JSON object, no other text, no markdown.` }
          ]
        }]
      })
    })

    if (!response.ok) { const e = await response.json().catch(()=>({})); return res.status(500).json({ error: e?.error?.message || 'Claude error' }) }
    const data = await response.json()
    let text = data.content[0].text.trim().replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(text)
    const extractedCoc = parsed.order_number || cocNumber || ''
    const projectAddress = parsed.project_address || ''
    return res.status(200).json({ samples: parsed.samples || [], cocNumber: extractedCoc, projectAddress })

  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
