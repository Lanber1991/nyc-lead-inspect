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
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system: 'You are a certified IAQ and lead paint inspection professional. Rewrite rough field notes as polished, professional, report-ready sentences. Write in past tense, third person. Be specific and technical but clear. Do not invent details. 2-4 sentences maximum. Return only the refined text.',
        messages: [{ role: 'user', content: `Context: ${context || 'IAQ inspection'}\n\nRaw notes: "${notes}"\n\nRewrite professionally:` }]
      })
    })
    if (!response.ok) { const e = await response.json().catch(()=>({})); return res.status(500).json({ error: e?.error?.message || 'Claude error' }) }
    const data = await response.json()
    return res.status(200).json({ refined: data.content[0].text.trim() })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
