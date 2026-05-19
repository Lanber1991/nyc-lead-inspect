import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export default async function handler(req, res) {
  const { id } = req.query

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('inspections')
      .select('*')
      .eq('id', id)
      .single()

    if (error) return res.status(404).json({ error: 'Not found' })
    return res.status(200).json(data)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
