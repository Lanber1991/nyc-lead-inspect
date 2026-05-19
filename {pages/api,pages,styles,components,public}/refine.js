export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { notes, context } = req.body
  if (!notes || !notes.trim()) return res.status(400).json({ error: 'No notes provided' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' })

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system: `You are a certified IAQ and lead paint inspection professional. Your job is to take rough field notes written by an inspector and rewrite them as polished, professional, report-ready sentences. Write in past tense, third person. Be specific and technical but clear. Use proper IAQ terminology. Do not invent details not present in the original notes. Keep it concise — 2-4 sentences maximum. Return only the refined text, nothing else.`,
        messages: [{ role: 'user', content: `Context: ${context || 'IAQ inspection notes'}\n\nRaw inspector notes: "${notes}"\n\nRewrite as professional report sentences:` }]
      })
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      return res.status(500).json({ error: err?.error?.message || `Claude error ${response.status}` })
    }

    const data = await response.json()
    return res.status(200).json({ refined: data.content[0].text.trim() })

  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
