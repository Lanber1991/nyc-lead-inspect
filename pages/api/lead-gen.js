export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { messages, tools } = req.body
  if (!messages) return res.status(400).json({ error: 'messages required' })

  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: 6000,
    messages,
  }
  if (tools) body.tools = tools

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'web-search-2025-03-05',
    },
    body: JSON.stringify(body),
  })

  const data = await upstream.json()
  if (!upstream.ok) return res.status(upstream.status).json(data)
  return res.status(200).json(data)
}

export const config = { api: { responseLimit: '4mb' } }
