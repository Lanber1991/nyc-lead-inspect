export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { violationDesc, propertyAddress } = req.body
  if (!violationDesc) return res.status(400).json({ error: 'violationDesc required' })

  const prompt = `You are a NYS licensed lead inspector preparing a pre-abatement assessment checklist based on an HPD lead paint violation.

HPD Violation Description:
"${violationDesc}"

Property: ${propertyAddress || 'Not provided'}

Generate a structured inspection checklist that a lead inspector would use to document lead paint hazard conditions related to this violation. Return a JSON array with 4-8 items. Each item:
- "description": what the inspector should inspect/document (specific, actionable, 1 sentence — focus on paint condition, substrate, friction/impact surfaces, deterioration)
- "needsMoisture": true if a moisture or XRF reading should be noted at this location
- "category": one of "visual", "xrf", "dust-wipe", "structural"

Return ONLY valid JSON, no other text. Example format:
[{"description":"Inspect window sill and trough for deteriorated or peeling lead paint on friction surfaces","needsMoisture":false,"category":"xrf"}]`

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!resp.ok) throw new Error(`Claude API ${resp.status}`)
    const data = await resp.json()
    const text = data.content?.[0]?.text || '[]'
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    const items = jsonMatch ? JSON.parse(jsonMatch[0]) : []
    return res.status(200).json({ items })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
