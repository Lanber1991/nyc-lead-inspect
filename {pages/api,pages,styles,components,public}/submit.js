import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export default async function handler(req, res) {
  // Allow requests from anywhere including local HTML files
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

  return res.status(200).json({ success: true, id: data.id, report_number: data.report_number })
}
