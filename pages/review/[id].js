import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { supabase } from '../../lib/supabaseClient'

const REPORT_SECTIONS = [
  { key: 'visual',          label: '1. Visual Inspection',        hint: 'Site conditions, property details, visual observations' },
  { key: 'areas',           label: '2. Affected Areas',           hint: 'Mold/moisture findings across all documented areas' },
  { key: 'samples',         label: '3. Air Sampling',             hint: 'Air sample results and their significance' },
  { key: 'hvac',            label: '4. HVAC Inspection',          hint: 'HVAC findings and relationship to IAQ issues' },
  { key: 'recommendations', label: '5. Recommendations',          hint: 'Professional recommendations and conclusions' },
]

const WORKPLAN_SECTIONS = [
  { key: 'projectSummary',             label: 'Project Summary',             hint: 'Overview of findings and scope of remediation' },
  { key: 'specialConsiderations',      label: 'Special Considerations',      hint: 'Vulnerable occupants, unusual conditions, structural concerns' },
  { key: 'ppeMatrix',                  label: 'PPE Requirements',            hint: 'Personal protective equipment requirements' },
  { key: 'containmentOverview',        label: 'Containment Overview',        hint: 'Project-wide containment requirements' },
  { key: 'wasteManagement',            label: 'Waste Management',            hint: 'Waste handling, transport, and disposal protocol' },
  { key: 'hvacProtocol',               label: 'HVAC Protocol',               hint: 'HVAC-specific work requirements' },
  { key: 'postRemediationVerification',label: 'Post-Remediation Verification',hint: 'Clearance testing requirements' },
  { key: 'assessorStatement',          label: 'Assessor Statement',          hint: 'Professional certification statement' },
]

export default function ReviewPage() {
  const router = useRouter()
  const { id, type: typeParam } = router.query
  const [type, setType] = useState('report')
  const [insp, setInsp] = useState(null)
  const [loading, setLoading] = useState(true)
  const [html, setHtml] = useState('')
  const [openSection, setOpenSection] = useState(null)
  const [instructions, setInstructions] = useState({})
  const [refining, setRefining] = useState(null)
  const [msg, setMsg] = useState('')
  const [msgType, setMsgType] = useState('success')
  const [hasUndo, setHasUndo] = useState(false)
  const [undoing, setUndoing] = useState(false)

  useEffect(() => {
    if (typeParam) setType(typeParam)
  }, [typeParam])

  useEffect(() => {
    if (!id) return
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push('/login'); return }
      fetchInspection()
    })
  }, [id])

  useEffect(() => {
    if (insp) updateHtmlForType(insp)
  }, [insp, type])

  async function fetchInspection() {
    setLoading(true)
    const res = await fetch(`/api/inspections/${id}`)
    if (res.ok) {
      const data = await res.json()
      setInsp(data)
      const rd = data.review_data || {}
      setHasUndo(!!(rd.prev_report_html || rd.prev_workplan_data))
    }
    setLoading(false)
  }

  function updateHtmlForType(data) {
    if (type === 'report') {
      setHtml(data.report_html || '')
    } else {
      setHtml(data.work_plan_data?.contentHtml || data.work_plan_data?.html || '')
    }
  }

  function showMsg(text, t = 'success') {
    setMsg(text); setMsgType(t)
    setTimeout(() => setMsg(''), 5000)
  }

  async function refineSection(sectionKey) {
    const instr = (instructions[sectionKey] || '').trim()
    if (!instr) { showMsg('Enter instructions for how to change this section', 'error'); return }
    setRefining(sectionKey)
    try {
      const res = await fetch('/api/refine-section', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inspectionId: id, type, sectionKey, instructions: instr }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        setHtml(data.html)
        setHasUndo(true)
        setInstructions(prev => ({ ...prev, [sectionKey]: '' }))
        showMsg('Section updated — preview refreshed')
      } else {
        showMsg(data.error || 'Refinement failed', 'error')
      }
    } catch (err) {
      showMsg(err.message, 'error')
    }
    setRefining(null)
  }

  async function handleUndo() {
    setUndoing(true)
    try {
      const res = await fetch('/api/refine-section', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inspectionId: id, type, sectionKey: '_undo', action: 'undo' }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        setHtml(data.html)
        setHasUndo(false)
        showMsg('Reverted to previous version')
      } else {
        showMsg(data.error || 'Undo failed', 'error')
      }
    } catch (err) {
      showMsg(err.message, 'error')
    }
    setUndoing(false)
  }

  function switchType(t) {
    setType(t)
    setOpenSection(null)
    setInstructions({})
    router.replace(`/review/${id}?type=${t}`, undefined, { shallow: true })
  }

  const sections = type === 'report' ? REPORT_SECTIONS : WORKPLAN_SECTIONS
  const hasContent = type === 'report' ? !!(insp?.report_html) : !!(insp?.work_plan_data?.contentHtml || insp?.work_plan_data?.html)

  if (loading) return (
    <div style={{ padding: '48px', textAlign: 'center', fontFamily: 'system-ui,sans-serif', color: '#94A3B8' }}>Loading…</div>
  )
  if (!insp) return (
    <div style={{ padding: '48px', textAlign: 'center', fontFamily: 'system-ui,sans-serif' }}>
      Not found. <a href="/" style={{ color: '#185FA5' }}>Back</a>
    </div>
  )

  return (
    <>
      <Head><title>Review — {insp.report_number}</title></Head>
      <div style={{ minHeight: '100vh', background: '#F8FAFC', fontFamily: 'system-ui,sans-serif', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ background: '#0E2A50', padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
            <a href={`/inspection/${id}`} style={{ color: '#93C5FD', fontSize: '13px', textDecoration: 'none', flexShrink: 0 }}>← Back</a>
            <span style={{ color: 'white', fontSize: '14px', fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Review & Refine — {insp.report_number}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            <div style={{ display: 'flex', borderRadius: '8px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.25)' }}>
              {['report', 'workplan'].map(t => (
                <button key={t} onClick={() => switchType(t)}
                  style={{ background: type === t ? 'white' : 'transparent', color: type === t ? '#0E2A50' : '#93C5FD', border: 'none', padding: '6px 14px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>
                  {t === 'report' ? 'Report' : 'Work Plan'}
                </button>
              ))}
            </div>
            {hasUndo && (
              <button onClick={handleUndo} disabled={undoing}
                style={{ background: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', padding: '6px 14px', fontSize: '12px', cursor: 'pointer', opacity: undoing ? 0.6 : 1 }}>
                {undoing ? '…' : '↩ Undo'}
              </button>
            )}
            {hasContent && (
              <a href={type === 'report' ? `/api/report-pdf/${id}` : `/api/work-plan-pdf/${id}`}
                target="_blank" rel="noopener noreferrer"
                style={{ background: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', padding: '6px 14px', fontSize: '12px', textDecoration: 'none' }}>
                ↓ PDF
              </a>
            )}
          </div>
        </div>

        {msg && (
          <div style={{ background: msgType === 'error' ? '#FEE2E2' : '#D1FAE5', color: msgType === 'error' ? '#991B1B' : '#065F46', padding: '9px 20px', fontSize: '13px', textAlign: 'center', flexShrink: 0, borderBottom: '1px solid #E2E8F0' }}>
            {msg}
          </div>
        )}

        {!hasContent ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px', color: '#64748B', fontFamily: 'system-ui,sans-serif' }}>
            <div style={{ fontSize: '16px' }}>No {type === 'report' ? 'report' : 'work plan'} generated yet.</div>
            <a href={`/inspection/${id}`} style={{ color: '#185FA5', fontSize: '13px' }}>← Back to Inspection</a>
          </div>
        ) : (
          <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>

            {/* Sections panel */}
            <div style={{ width: '300px', flexShrink: 0, borderRight: '1px solid #E2E8F0', overflowY: 'auto', background: 'white', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid #E2E8F0', flexShrink: 0 }}>
                <div style={{ fontSize: '11px', fontWeight: '700', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Sections</div>
                <div style={{ fontSize: '12px', color: '#64748B', marginTop: '4px', lineHeight: '1.4' }}>
                  Click a section, describe the change, hit Refine
                </div>
              </div>

              {sections.map(sec => (
                <div key={sec.key} style={{ borderBottom: '1px solid #F1F5F9' }}>
                  <button
                    onClick={() => setOpenSection(openSection === sec.key ? null : sec.key)}
                    style={{ width: '100%', padding: '11px 16px', background: openSection === sec.key ? '#F0F7FF' : 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', textAlign: 'left', gap: '8px' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: '500', color: '#0F172A' }}>{sec.label}</div>
                      <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '2px', lineHeight: '1.3' }}>{sec.hint}</div>
                    </div>
                    <span style={{ color: '#94A3B8', fontSize: '11px', flexShrink: 0, marginTop: '2px' }}>{openSection === sec.key ? '▲' : '▼'}</span>
                  </button>

                  {openSection === sec.key && (
                    <div style={{ padding: '0 14px 14px' }}>
                      <textarea
                        value={instructions[sec.key] || ''}
                        onChange={e => setInstructions(prev => ({ ...prev, [sec.key]: e.target.value }))}
                        placeholder={'e.g. "Make this more concise" · "Emphasize the bathroom moisture reading" · "Add more detail about containment"'}
                        rows={4}
                        style={{ width: '100%', padding: '9px 10px', border: '1px solid #D1D5DB', borderRadius: '8px', fontSize: '12px', resize: 'vertical', fontFamily: 'inherit', color: '#334155', outline: 'none', boxSizing: 'border-box', lineHeight: '1.5' }}
                        onFocus={e => e.target.style.borderColor = '#185FA5'}
                        onBlur={e => e.target.style.borderColor = '#D1D5DB'}
                      />
                      <button
                        onClick={() => refineSection(sec.key)}
                        disabled={!!refining}
                        style={{ marginTop: '8px', width: '100%', background: refining ? '#94A3B8' : '#185FA5', color: 'white', border: 'none', borderRadius: '8px', padding: '10px', fontSize: '13px', fontWeight: '500', cursor: refining ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px' }}>
                        {refining === sec.key ? (
                          <>
                            <div style={{ width: '12px', height: '12px', border: '2px solid rgba(255,255,255,0.4)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
                            Refining…
                          </>
                        ) : refining ? 'Busy…' : '✦ Refine This Section'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Preview iframe */}
            <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
              {refining && (
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(248,250,252,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
                  <div style={{ background: 'white', borderRadius: '12px', padding: '24px 32px', border: '1px solid #E2E8F0', textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,0.1)' }}>
                    <div style={{ width: '28px', height: '28px', border: '3px solid #BFDBFE', borderTopColor: '#185FA5', borderRadius: '50%', animation: 'spin 0.7s linear infinite', margin: '0 auto 12px' }} />
                    <div style={{ fontSize: '14px', fontWeight: '500', color: '#0F172A' }}>Claude is rewriting this section…</div>
                    <div style={{ fontSize: '12px', color: '#64748B', marginTop: '4px' }}>Preview will update automatically</div>
                  </div>
                </div>
              )}
              <iframe
                srcDoc={html}
                style={{ width: '100%', height: '100%', border: 'none', background: 'white', display: 'block' }}
                title="Document Preview"
                sandbox="allow-same-origin"
              />
            </div>
          </div>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </>
  )
}
