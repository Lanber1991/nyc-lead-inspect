export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { samples, reportNumber } = req.body
  if (!samples) return res.status(400).json({ error: 'No samples provided' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' })

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1200,
        system: 'You are a certified IAQ professional interpreting EMSL laboratory results for NYC Lead Inspections. Write in plain prose only — no markdown, no asterisks, no pound signs, no headers, no bullet points, no bold formatting. Write as a professional assessor would speak to a building owner: clear, direct, and authoritative. Compare indoor samples to the outdoor control where available. Do not invent data.',
        messages: [{
          role: 'user',
          content: `Interpret these EMSL lab results for IAQ report${reportNumber ? ` #${reportNumber}` : ''}.

Raw data:
${JSON.stringify(samples, null, 2)}

Write three plain paragraphs with no formatting characters whatsoever:
Paragraph 1: Overall findings — what the samples show compared to the outdoor control and what it means.
Paragraph 2: Species identified — what each species is and why it matters in plain language.
Paragraph 3: Conclusion and recommended next steps.

Plain prose only. No markdown. No headers. No asterisks. No pound signs.`
        }]
      })
    })

    if (!response.ok) { const e = await response.json().catch(()=>({})); return res.status(500).json({ error: e?.error?.message || 'Claude error' }) }
    const data = await response.json()
    return res.status(200).json({ narrative: data.content[0].text.trim() })

  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
