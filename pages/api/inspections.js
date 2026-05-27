import { createClient } from '@supabase/supabase-js'

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } }

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('inspections')
      .select('id, report_number, inspector_name, property_address, property_city, client_name, inspection_date, status, submitted_at, lab_data, work_plan_data, report_html')
      .order('submitted_at', { ascending: false })

    if (error) return res.status(500).json({ error: error.message })

    // Strip large HTML fields — return only boolean indicators to keep payload small
    const summary = data.map(({ lab_data, work_plan_data, report_html, ...rest }) => ({
      ...rest,
      has_lab:       !!lab_data,
      has_report:    !!report_html,
      wp_generated:  !!(work_plan_data?.contentHtml || work_plan_data?.html),
      wp_reviewed:   !!work_plan_data?.reviewed,
    }))
    return res.status(200).json(summary)
  }

  if (req.method === 'PATCH') {
    const { id, status, lab_data, work_plan_data, form_data, review_data } = req.body
    const updates = {}
    if (status !== undefined) updates.status = status
    if (lab_data) updates.lab_data = lab_data
    if (work_plan_data) updates.work_plan_data = work_plan_data
    if (form_data) updates.form_data = form_data
    if (review_data !== undefined) updates.review_data = review_data

    const { data, error } = await supabase
      .from('inspections')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json(data)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
