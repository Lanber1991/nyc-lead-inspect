import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const MARKER_START = key => `<!-- REFINE:${key}:start -->`
const MARKER_END   = key => `<!-- REFINE:${key}:end -->`

function extractSection(html, key) {
  const s = MARKER_START(key), e = MARKER_END(key)
  const si = html.indexOf(s), ei = html.indexOf(e)
  if (si === -1 || ei === -1) return ''
  const inner = html.slice(si + s.length, ei)
  return inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function replaceSection(html, key, newInner) {
  const s = MARKER_START(key), e = MARKER_END(key)
  const si = html.indexOf(s), ei = html.indexOf(e)
  if (si === -1 || ei === -1) return html
  return html.slice(0, si + s.length) + newInner + html.slice(ei)
}

function textToParas(text) {
  return text.split(/\n\n+/).filter(p => p.trim())
    .map(p => `<p style="margin:0 0 10px 0">${p.replace(/\n/g, ' ').trim()}</p>`).join('')
}

function buildReportSectionHtml(text) {
  if (!text) return ''
  return `<div class="ai-block" style="margin-top:14px"><div class="ai-label">Inspector Summary</div><div class="ai-text">${textToParas(text)}</div></div>`
}

const SECTION_LABELS = {
  visual:                    'Visual Inspection Summary',
  areas:                     'Affected Areas Summary',
  samples:                   'Air Sampling Summary',
  hvac:                      'HVAC Inspection Summary',
  recommendations:           'Recommendations & Conclusions',
  projectSummary:            'Project Summary',
  specialConsiderations:     'Special Considerations',
  ppeMatrix:                 'PPE Requirements',
  containmentOverview:       'Containment Specifications',
  wasteManagement:           'Waste Management & Disposal',
  hvacProtocol:              'HVAC Protocol',
  postRemediationVerification: 'Post-Remediation Verification',
  assessorStatement:         'Assessor Statement',
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { inspectionId, type, sectionKey, instructions, action } = req.body
  if (!inspectionId || !type) return res.status(400).json({ error: 'Missing required fields' })

  const { data: insp, error: fetchErr } = await supabase
    .from('inspections')
    .select('*')
    .eq('id', inspectionId)
    .single()
  if (fetchErr || !insp) return res.status(404).json({ error: 'Inspection not found' })

  // ── UNDO ──────────────────────────────────────────────────────────────────
  if (action === 'undo') {
    const rd = insp.review_data || {}
    if (type === 'report' && rd.prev_report_html) {
      const prevHtml = rd.prev_report_html
      const { error: e1 } = await supabase.from('inspections')
        .update({ report_html: prevHtml, review_data: { ...rd, prev_report_html: null } })
        .eq('id', inspectionId)
      if (e1) await supabase.from('inspections').update({ report_html: prevHtml }).eq('id', inspectionId)
      return res.status(200).json({ success: true, html: prevHtml })
    }
    if (type === 'workplan' && rd.prev_workplan_data) {
      const prevWp = rd.prev_workplan_data
      const prevHtml = prevWp.contentHtml || prevWp.html || ''
      const { error: e2 } = await supabase.from('inspections')
        .update({ work_plan_data: prevWp, review_data: { ...rd, prev_workplan_data: null } })
        .eq('id', inspectionId)
      if (e2) await supabase.from('inspections').update({ work_plan_data: prevWp }).eq('id', inspectionId)
      return res.status(200).json({ success: true, html: prevHtml })
    }
    return res.status(400).json({ error: 'No undo state available' })
  }

  if (!sectionKey || !instructions) return res.status(400).json({ error: 'sectionKey and instructions required' })

  // ── REFINE ────────────────────────────────────────────────────────────────
  const currentHtml = type === 'report'
    ? (insp.report_html || '')
    : (insp.work_plan_data?.contentHtml || insp.work_plan_data?.html || '')

  const currentText = extractSection(currentHtml, sectionKey)

  const fd = insp.form_data || {}
  const context = `Property: ${fd.propAddr || insp.property_address}, ${insp.property_city}
Inspector: ${insp.inspector_name} | Date: ${insp.inspection_date}
Client: ${insp.client_name || '—'} | Report #: ${insp.report_number}
Overall Risk: ${fd.riskLevel || '—'}`

  const SYSTEM_REPORT = `You are editing a section of a professional Lead Paint Inspection Report prepared by a NYS licensed mold assessor at NYC Lead Inspections. Rewrite the section according to the inspector's instructions. Maintain professional, technical language appropriate for a formal assessment document. Write in past tense, third person. Plain prose only — no markdown, no bullet points, no headers. Return ONLY the revised text, nothing else.`

  const SYSTEM_WORKPLAN = `You are editing a section of a formal Lead Abatement Work Plan prepared under NYS DOL 12 NYCRR Part 820. Rewrite the section according to the inspector's instructions. Maintain precise, technical language appropriate for a regulatory compliance document. Return ONLY the revised text, nothing else.`

  const sectionName = SECTION_LABELS[sectionKey] || sectionKey
  const prompt = `Inspection context:\n${context}\n\nSection: ${sectionName}\n\nCurrent text:\n${currentText || '(empty — write fresh content for this section)'}\n\nInstructions: ${instructions}\n\nRevised text:`

  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      system: type === 'report' ? SYSTEM_REPORT : SYSTEM_WORKPLAN,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  const aiData = await aiRes.json()
  if (!aiRes.ok) return res.status(500).json({ error: aiData.error?.message || 'Claude API error' })
  const newText = aiData.content?.[0]?.text?.trim() || ''

  const newInner = type === 'report' ? buildReportSectionHtml(newText) : newText
  const newHtml = replaceSection(currentHtml, sectionKey, newInner)

  // Save with undo state
  if (type === 'report') {
    const rd = insp.review_data || {}
    const { error: saveErr } = await supabase.from('inspections')
      .update({ report_html: newHtml, review_data: { ...rd, prev_report_html: insp.report_html } })
      .eq('id', inspectionId)
    if (saveErr) {
      await supabase.from('inspections').update({ report_html: newHtml }).eq('id', inspectionId)
    }
  } else {
    const wpData = insp.work_plan_data || {}
    const rd = insp.review_data || {}
    const newWpData = { ...wpData, contentHtml: newHtml }
    const { error: saveErr } = await supabase.from('inspections')
      .update({ work_plan_data: newWpData, review_data: { ...rd, prev_workplan_data: wpData } })
      .eq('id', inspectionId)
    if (saveErr) {
      await supabase.from('inspections').update({ work_plan_data: newWpData }).eq('id', inspectionId)
    }
  }

  return res.status(200).json({ success: true, html: newHtml })
}
