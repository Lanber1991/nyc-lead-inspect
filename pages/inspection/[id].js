import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { supabase } from '../../lib/supabaseClient'

const STATUS_COLORS = {
  pending:      { bg:'#FEF3C7', text:'#92400E', border:'#FCD34D', label:'Pending Lab Results' },
  lab_received: { bg:'#DBEAFE', text:'#1E40AF', border:'#93C5FD', label:'Lab Received' },
  complete:     { bg:'#D1FAE5', text:'#065F46', border:'#6EE7B7', label:'Complete' },
}

export default function InspectionDetail() {
  const router = useRouter()
  const { id } = router.query
  const [insp, setInsp] = useState(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [msg, setMsg] = useState('')
  const [msgType, setMsgType] = useState('success')
  const [labStatus, setLabStatus] = useState('')
  const [labResults, setLabResults] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [workPlanStatus, setWorkPlanStatus] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [areaScope, setAreaScope] = useState([])
  const [scopeSaving, setScopeSaving] = useState(false)

  useEffect(() => {
    if (!id) return
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push('/login'); return }
      fetchInspection()
    })
  }, [id])

  async function fetchInspection() {
    setLoading(true)
    const res = await fetch(`/api/inspections/${id}`)
    if (res.ok) {
      const data = await res.json()
      setInsp(data)
      if (data.lab_data) setLabResults(data.lab_data)
      const areas = data.form_data?.affectedAreas || []
      if (data.form_data?.areaActions?.length > 0) {
        setAreaScope(data.form_data.areaActions)
      } else {
        setAreaScope(areas.map(() => 'Investigate / Monitor'))
      }
    }
    setLoading(false)
  }

  async function saveAreaScope() {
    setScopeSaving(true)
    try {
      const updatedFd = { ...(insp.form_data || {}), areaActions: areaScope }
      const res = await fetch('/api/inspections', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, form_data: updatedFd })
      })
      if (res.ok) {
        showMsg('Work plan scope saved')
        await fetchInspection()
      } else {
        const errBody = await res.text().catch(() => '')
        showMsg(`Save failed (${res.status})${errBody ? ': ' + errBody.slice(0, 120) : ''}`, 'error')
      }
    } catch (e) {
      showMsg(`Save failed: ${e.message}`, 'error')
    } finally {
      setScopeSaving(false)
    }
  }

  function showMsg(text, type='success') {
    setMsg(text); setMsgType(type)
    if (type !== 'error') setTimeout(() => setMsg(''), 4000)
  }

  async function markWorkPlanReviewed() {
    setReviewing(true)
    const updated = { ...insp.work_plan_data, reviewed: true, reviewedAt: new Date().toISOString() }
    const patchRes = await fetch('/api/inspections', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, work_plan_data: updated })
    })
    if (!patchRes.ok) { showMsg('Could not save review status', 'error'); setReviewing(false); return }
    await fetchInspection()
    const emailRes = await fetch('/api/send-work-plan-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inspectionId: id })
    })
    if (emailRes.ok) showMsg('Work plan marked as reviewed — email sent')
    else showMsg('Marked as reviewed but email failed to send', 'error')
    setReviewing(false)
  }

  async function generateWorkPlan() {
    setWorkPlanStatus('generating')
    setMsg('')
    try {
      const res = await fetch('/api/generate-work-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inspectionId: id })
      })
      const data = await res.json()
      if (res.ok && data.success) {
        showMsg(`Work Plan ${data.workPlanNumber} generated (${data.overallLevel})${data.emailSent ? ' — emailed successfully' : ''}`)
        await fetchInspection()
      } else {
        showMsg(data.error || 'Work plan generation failed', 'error')
      }
    } catch (err) {
      showMsg(`Error: ${err.message}`, 'error')
    }
    setWorkPlanStatus('')
  }

  async function generateReport() {
    setUpdating(true)
    setMsg('')
    try {
      const res = await fetch('/api/generate-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inspectionId: id })
      })
      const data = await res.json()
      if (res.ok && data.success) {
        showMsg(`Report generated and emailed${data.emailSent ? ' successfully' : ' (email may have failed)'}`)
        await fetchInspection()
      } else {
        showMsg(data.error || 'Report generation failed', 'error')
      }
    } catch (err) {
      showMsg(`Error: ${err.message}`, 'error')
    }
    setUpdating(false)
  }

  async function updateStatus(status) {
    setUpdating(true)
    const res = await fetch('/api/inspections', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status })
    })
    if (res.ok) { showMsg(`Status updated to "${STATUS_COLORS[status]?.label}"`); await fetchInspection() }
    else showMsg('Update failed', 'error')
    setUpdating(false)
  }

  async function markVisualOnly() {
    setUpdating(true)
    const updatedFd = { ...(insp.form_data || {}), visual_only: true }
    const res = await fetch('/api/inspections', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, form_data: updatedFd })
    })
    if (res.ok) { showMsg('Marked as visual inspection only — generate report when ready'); await fetchInspection() }
    else showMsg('Update failed', 'error')
    setUpdating(false)
  }

  async function processLabPdf(file) {
    if (!file || file.type !== 'application/pdf') { showMsg('Please use a PDF file', 'error'); return }
    setLabStatus('Reading PDF...')
    const reader = new FileReader()
    reader.onload = async (e) => {
      const base64 = e.target.result.split(',')[1]
      setLabStatus('Extracting results with Claude...')
      try {
        const extractRes = await fetch('/api/lab-extract', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pdfBase64: base64, cocNumber: insp?.form_data?.cocNumber || '' })
        })
        if (!extractRes.ok) throw new Error('Extraction failed')
        const extracted = await extractRes.json()
        setLabStatus('Writing interpretation...')
        const interpretRes = await fetch('/api/lab-interpret', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ samples: extracted.samples, reportNumber: insp?.report_number })
        })
        if (!interpretRes.ok) throw new Error('Interpretation failed')
        const interpreted = await interpretRes.json()
        const labData = { samples: extracted.samples, narrative: interpreted.narrative, processedAt: new Date().toISOString(), source: 'drag-drop', labPdfBase64: base64 }
        await fetch('/api/inspections', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, status: 'lab_received', lab_data: labData })
        })
        setLabResults(labData); setLabStatus('')
        showMsg('Lab results extracted and saved successfully')
        await fetchInspection()
      } catch(err) { setLabStatus(''); showMsg(`Error: ${err.message}`, 'error') }
    }
    reader.readAsDataURL(file)
  }

  function onDrop(e) { e.preventDefault(); setDragging(false); processLabPdf(e.dataTransfer.files[0]) }

  function formatDate(d) {
    if (!d) return '—'
    try { return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' }) }
    catch(e) { return d }
  }

  if (loading) return <div style={{padding:'48px',textAlign:'center',fontFamily:'system-ui,sans-serif',color:'#94A3B8'}}>Loading…</div>
  if (!insp) return <div style={{padding:'48px',textAlign:'center',fontFamily:'system-ui,sans-serif'}}>Not found. <a href="/" style={{color:'#185FA5'}}>Back</a></div>

  const s = STATUS_COLORS[insp.status] || STATUS_COLORS.pending
  const fd = insp.form_data || {}

  const hasLab = !!insp.lab_data
  const hasReport = !!insp.report_html
  const scopeSet = !!(fd.areaActions?.length > 0)
  const hasWorkPlan = !!(insp.work_plan_data?.contentHtml || insp.work_plan_data?.html)
  const wpReviewed = !!insp.work_plan_data?.reviewed
  const isComplete = insp.status === 'complete'
  const visualOnly = !!(fd.visual_only)

  const pipelineStages = [
    ...(visualOnly ? [] : [{ key:'lab',      label:'Lab Results',    done: hasLab }]),
    { key:'report',   label:'Report',         done: hasReport },
    { key:'scope',    label:'Flag Areas',     done: scopeSet },
    { key:'workplan', label:'Work Plan',       done: hasWorkPlan },
    { key:'reviewed', label:'Reviewed & Sent', done: wpReviewed },
    { key:'complete', label:'Complete',        done: isComplete },
  ]
  const activeIdx = isComplete ? pipelineStages.length : pipelineStages.findIndex(st => !st.done)
  const activeKey = isComplete ? 'done' : (pipelineStages[activeIdx]?.key || '')

  return (
    <>
      <Head><title>{insp.report_number} — {insp.property_address}</title></Head>
      <div style={{minHeight:'100vh',background:'#F8FAFC',fontFamily:'system-ui,sans-serif'}}>
        <div style={{background:'#0E2A50',padding:'16px 24px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{display:'flex',alignItems:'center',gap:'16px'}}>
            <a href="/" style={{color:'#93C5FD',fontSize:'13px',textDecoration:'none'}}>← Dashboard</a>
            <div style={{color:'white',fontSize:'16px',fontWeight:'600'}}>{insp.report_number}</div>
          </div>
          <span style={{background:s.bg,color:s.text,border:`1px solid ${s.border}`,borderRadius:'20px',padding:'4px 12px',fontSize:'12px',fontWeight:'500'}}>{s.label}</span>
        </div>

        {/* Sticky Action Bar */}
        <div style={{position:'sticky',top:0,zIndex:100,background:'white',borderBottom:'1px solid #E2E8F0',padding:'12px 24px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:'16px'}}>
          {/* Pipeline */}
          <div style={{display:'flex',alignItems:'center',gap:'0',overflowX:'auto',flexShrink:1,minWidth:0}}>
            {pipelineStages.map((stage, i) => {
              const done = stage.done
              const active = i === activeIdx
              return (
                <div key={stage.key} style={{display:'flex',alignItems:'center'}}>
                  {i > 0 && (
                    <div style={{width:'28px',height:'2px',background:pipelineStages[i-1].done?'#10B981':'#E2E8F0',flexShrink:0}} />
                  )}
                  <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:'3px',flexShrink:0}}>
                    <div style={{
                      width:'26px',height:'26px',borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',
                      fontSize:'11px',fontWeight:'700',
                      background: done ? '#10B981' : active ? '#0E2A50' : '#F1F5F9',
                      color: done || active ? 'white' : '#94A3B8',
                      border: active ? '2px solid #0E2A50' : 'none',
                    }}>
                      {done ? '✓' : i + 1}
                    </div>
                    <div style={{fontSize:'10px',fontWeight:'500',whiteSpace:'nowrap',color:done?'#059669':active?'#0E2A50':'#94A3B8'}}>
                      {stage.label}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Primary action for current stage */}
          <div style={{display:'flex',gap:'8px',alignItems:'center',flexShrink:0}}>
            {activeKey === 'lab' && (
              <span style={{fontSize:'12px',color:'#64748B'}}>Drop EMSL PDF below</span>
            )}
            {activeKey === 'report' && (
              <button onClick={generateReport} disabled={updating} style={{background:'#185FA5',color:'white',border:'none',borderRadius:'8px',padding:'9px 16px',fontSize:'13px',fontWeight:'500',cursor:updating?'not-allowed':'pointer',opacity:updating?0.7:1,whiteSpace:'nowrap'}}>
                {updating ? 'Generating…' : '✦ Generate & Email Report'}
              </button>
            )}
            {activeKey === 'scope' && (
              <span style={{fontSize:'12px',color:'#64748B'}}>Flag each area below, then save</span>
            )}
            {activeKey === 'workplan' && (
              <button onClick={generateWorkPlan} disabled={workPlanStatus==='generating'} style={{background:'#0E2A50',color:'white',border:'none',borderRadius:'8px',padding:'9px 16px',fontSize:'13px',fontWeight:'500',cursor:workPlanStatus==='generating'?'not-allowed':'pointer',opacity:workPlanStatus==='generating'?0.7:1,whiteSpace:'nowrap'}}>
                {workPlanStatus === 'generating' ? 'Generating…' : '⊞ Generate Work Plan'}
              </button>
            )}
            {hasReport && activeKey !== 'report' && (
              <button onClick={generateReport} disabled={updating} style={{background:'white',color:'#185FA5',border:'1px solid #185FA5',borderRadius:'8px',padding:'9px 16px',fontSize:'13px',fontWeight:'500',cursor:updating?'not-allowed':'pointer',opacity:updating?0.7:1,whiteSpace:'nowrap'}}>
                {updating ? 'Generating…' : '↻ Re-generate Report'}
              </button>
            )}
            {activeKey === 'reviewed' && (
              <>
                <a href={`/api/work-plan-pdf/${id}`} target="_blank" rel="noopener noreferrer" style={{background:'#F8FAFC',color:'#185FA5',border:'1px solid #E2E8F0',borderRadius:'8px',padding:'9px 16px',fontSize:'13px',fontWeight:'500',textDecoration:'none',whiteSpace:'nowrap'}}>
                  ↓ Download PDF
                </a>
                <button onClick={markWorkPlanReviewed} disabled={reviewing} style={{background:'#059669',color:'white',border:'none',borderRadius:'8px',padding:'9px 16px',fontSize:'13px',fontWeight:'500',cursor:reviewing?'not-allowed':'pointer',opacity:reviewing?0.7:1,whiteSpace:'nowrap'}}>
                  {reviewing ? 'Sending…' : '✓ Mark as Reviewed & Send'}
                </button>
              </>
            )}
            {activeKey === 'complete' && (
              <button onClick={()=>updateStatus('complete')} disabled={updating} style={{background:'#059669',color:'white',border:'none',borderRadius:'8px',padding:'9px 16px',fontSize:'13px',fontWeight:'500',cursor:'pointer',whiteSpace:'nowrap'}}>
                ✓ Mark Complete
              </button>
            )}
            {isComplete && (
              <span style={{fontSize:'13px',color:'#059669',fontWeight:'600'}}>✓ Complete</span>
            )}
          </div>
        </div>

        <div style={{maxWidth:'800px',margin:'0 auto',padding:'24px 16px'}}>
          {msg && (
            <div style={{background:msgType==='error'?'#FEE2E2':'#D1FAE5',color:msgType==='error'?'#991B1B':'#065F46',border:`1px solid ${msgType==='error'?'#FCA5A5':'#6EE7B7'}`,borderRadius:'8px',padding:'10px 16px',marginBottom:'16px',fontSize:'13px',display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:'12px'}}>
              <span>{msg}</span>
              {msgType === 'error' && <button onClick={()=>setMsg('')} style={{background:'none',border:'none',cursor:'pointer',color:'#991B1B',fontSize:'16px',lineHeight:1,padding:0,flexShrink:0}}>✕</button>}
            </div>
          )}

          {/* Property */}
          <div style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:'20px 24px',marginBottom:'16px'}}>
            <div style={{fontSize:'20px',fontWeight:'600',color:'#0F172A',marginBottom:'4px'}}>{insp.property_address}</div>
            <div style={{fontSize:'14px',color:'#64748B',marginBottom:'16px'}}>{insp.property_city} {insp.property_state_zip}</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'16px'}}>
              {[{label:'Client',value:insp.client_name},{label:'Inspector',value:insp.inspector_name},{label:'Date',value:formatDate(insp.inspection_date)},{label:'Purpose',value:insp.purpose},{label:'COC #',value:fd.cocNumber||'—'},{label:'Submitted',value:new Date(insp.submitted_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}].map(f=>(
                <div key={f.label}>
                  <div style={{fontSize:'11px',fontWeight:'600',color:'#94A3B8',textTransform:'uppercase',letterSpacing:'0.5px'}}>{f.label}</div>
                  <div style={{fontSize:'13px',color:'#334155',marginTop:'3px'}}>{f.value||'—'}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Lab Results / Visual Inspection */}
          <div style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:'20px 24px',marginBottom:'16px'}}>
            {visualOnly ? (
              <>
                <div style={{fontSize:'14px',fontWeight:'600',marginBottom:'12px',color:'#0F172A'}}>Inspection Type</div>
                <div style={{display:'flex',alignItems:'center',gap:'12px',padding:'14px 16px',background:'#EFF6FF',border:'1px solid #BFDBFE',borderRadius:'10px'}}>
                  <div style={{fontSize:'24px'}}>👁</div>
                  <div>
                    <div style={{fontSize:'13px',fontWeight:'600',color:'#1E40AF'}}>Visual Inspection Only</div>
                    <div style={{fontSize:'12px',color:'#3B82F6',marginTop:'2px'}}>No air sampling — report generates from visual findings, photos, and moisture readings</div>
                  </div>
                </div>
              </>
            ) : (
              <>
            <div style={{fontSize:'14px',fontWeight:'600',marginBottom:'4px',color:'#0F172A'}}>Lab Results</div>
            <div style={{fontSize:'12px',color:'#64748B',marginBottom:'16px'}}>{labResults?'Results processed and saved.':'Drop the EMSL PDF here when results arrive — Claude will extract and interpret automatically.'}</div>
            {labStatus && (
              <div style={{background:'#EFF6FF',border:'1px solid #BFDBFE',borderRadius:'8px',padding:'10px 16px',marginBottom:'12px',fontSize:'13px',color:'#1E40AF',display:'flex',alignItems:'center',gap:'8px'}}>
                <div style={{width:'10px',height:'10px',border:'2px solid #1E40AF',borderTopColor:'transparent',borderRadius:'50%',animation:'spin 0.7s linear infinite',flexShrink:0}}></div>
                {labStatus}
              </div>
            )}
            {!labResults ? (
              <div
                onDragOver={e=>{e.preventDefault();setDragging(true)}}
                onDragLeave={()=>setDragging(false)}
                onDrop={onDrop}
                onClick={()=>document.getElementById('labFileInput').click()}
                style={{border:`2px dashed ${dragging?'#185FA5':'#CBD5E1'}`,borderRadius:'10px',padding:'40px',textAlign:'center',cursor:'pointer',background:dragging?'#EFF6FF':'#F8FAFC',transition:'all 0.15s'}}>
                <div style={{fontSize:'36px',marginBottom:'8px'}}>📄</div>
                <div style={{fontSize:'14px',fontWeight:'500',color:dragging?'#185FA5':'#475569'}}>{dragging?'Drop to process':'Drop EMSL PDF here'}</div>
                <div style={{fontSize:'12px',color:'#94A3B8',marginTop:'4px'}}>or tap to browse</div>
                <input type="file" id="labFileInput" accept="application/pdf" style={{display:'none'}} onChange={e=>processLabPdf(e.target.files[0])} />
              </div>
            ) : (
              <div>
                <div style={{background:'#F0FDF4',border:'1px solid #86EFAC',borderRadius:'8px',padding:'12px 16px',marginBottom:'12px'}}>
                  <div style={{fontSize:'12px',fontWeight:'600',color:'#166534',marginBottom:'8px'}}>✓ {labResults.samples?.length||0} sample(s) extracted · {new Date(labResults.processedAt).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</div>
                  {labResults.samples?.map((s,i)=>(
                    <div key={i} style={{fontSize:'12px',color:'#166534',padding:'4px 0',borderTop:i>0?'1px solid #BBF7D0':'none'}}>
                      <strong>{s.sample_id}</strong> — {s.sample_type}{s.location?` · ${s.location}`:''}{s.outdoor_control?' (Outdoor Control)':''}
                      <div style={{color:'#4B5563',marginTop:'2px'}}>{s.raw_summary}</div>
                    </div>
                  ))}
                </div>
                {labResults.narrative && (
                  <div style={{background:'#EFF6FF',borderLeft:'3px solid #185FA5',borderRadius:'0 8px 8px 0',padding:'10px 14px',fontSize:'12px',color:'#1E3A5F',lineHeight:'1.6'}}>
                    <div style={{fontSize:'10px',fontWeight:'700',color:'#185FA5',marginBottom:'6px',letterSpacing:'0.5px'}}>CLAUDE INTERPRETATION</div>
                    {labResults.narrative.slice(0,500)}…
                  </div>
                )}
                <button onClick={()=>setLabResults(null)} style={{marginTop:'10px',fontSize:'12px',color:'#64748B',border:'1px solid #E2E8F0',borderRadius:'6px',padding:'5px 12px',background:'none',cursor:'pointer'}}>Replace PDF</button>
              </div>
            )}
            {!labResults && (
              <div style={{marginTop:'10px',textAlign:'center'}}>
                <button onClick={markVisualOnly} disabled={updating} style={{background:'none',border:'none',color:'#94A3B8',fontSize:'11px',cursor:'pointer',textDecoration:'underline'}}>
                  No lab samples — mark as visual inspection only
                </button>
              </div>
            )}
              </>
            )}
          </div>

          {/* Flag Areas — Work Plan Scope */}
          {hasReport && (fd.affectedAreas?.length > 0) && (
            <div style={{background:'white',borderRadius:'12px',border:`1px solid ${scopeSet?'#86EFAC':'#E2E8F0'}`,padding:'20px 24px',marginBottom:'16px'}}>
              <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'4px'}}>
                <div style={{fontSize:'14px',fontWeight:'600',color:'#0F172A'}}>Work Plan Scope</div>
                {scopeSet && <span style={{background:'#D1FAE5',color:'#065F46',border:'1px solid #6EE7B7',borderRadius:'20px',padding:'2px 10px',fontSize:'11px',fontWeight:'600'}}>✓ Saved</span>}
              </div>
              <div style={{fontSize:'12px',color:'#64748B',marginBottom:'16px'}}>Flag each area before generating the work plan. Defaults to Investigate / Monitor.</div>

              {(() => {
                const ACTIONS = [
                  { label:'Remediation Required',  activeBg:'#DC2626', activeColor:'white', inactiveBg:'#FEE2E2', inactiveColor:'#991B1B' },
                  { label:'Investigate / Monitor', activeBg:'#D97706', activeColor:'white', inactiveBg:'#FEF3C7', inactiveColor:'#92400E' },
                  { label:'Document Only',         activeBg:'#64748B', activeColor:'white', inactiveBg:'#F1F5F9', inactiveColor:'#475569' },
                ]
                const namedAreas = (fd.affectedAreas || []).map((area, i) => ({ area, i })).filter(({ area }) => area.room?.trim())
                return namedAreas.map(({ area, i }, ni) => {
                  const current = areaScope[i] || 'Investigate / Monitor'
                  return (
                    <div key={i} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'12px',padding:'10px 0',borderBottom: ni < namedAreas.length - 1 ? '1px solid #F1F5F9' : 'none',flexWrap:'wrap'}}>
                      <div style={{fontSize:'13px',fontWeight:'500',color:'#0F172A',minWidth:'160px'}}>
                        {area.room}{area.detail ? ` — ${area.detail}` : ''}
                        {area.area ? <span style={{fontSize:'11px',color:'#94A3B8',marginLeft:'6px'}}>{area.area} sq ft</span> : null}
                      </div>
                      <div style={{display:'flex',gap:'6px'}}>
                        {ACTIONS.map(a => {
                          const active = current === a.label
                          return (
                            <button key={a.label} onClick={() => { const s=[...areaScope]; s[i]=a.label; setAreaScope(s) }}
                              style={{padding:'5px 12px',borderRadius:'20px',fontSize:'11px',fontWeight:'600',border:'none',cursor:'pointer',
                                background: active ? a.activeBg : a.inactiveBg,
                                color: active ? a.activeColor : a.inactiveColor,
                              }}
                            >{a.label}</button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })
              })()}

              <div style={{marginTop:'16px',display:'flex',gap:'8px',alignItems:'center'}}>
                <button
                  onClick={saveAreaScope}
                  disabled={scopeSaving}
                  style={{background:'#0E2A50',color:'white',border:'none',borderRadius:'8px',padding:'9px 18px',fontSize:'13px',fontWeight:'500',cursor:scopeSaving?'not-allowed':'pointer',opacity:scopeSaving?0.7:1}}
                >
                  {scopeSaving ? 'Saving…' : scopeSet ? '↺ Update Scope' : '✓ Save Scope'}
                </button>
                <span style={{fontSize:'11px',color:'#94A3B8'}}>
                  {areaScope.filter(a => a === 'Remediation Required').length} remediation · {areaScope.filter(a => a === 'Investigate / Monitor').length} monitor · {areaScope.filter(a => a === 'Document Only').length} document only
                </span>
              </div>
            </div>
          )}

          {/* Work Plan */}
          <div style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:'20px 24px',marginBottom:'16px'}}>
            <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'4px'}}>
              <div style={{fontSize:'14px',fontWeight:'600',color:'#0F172A'}}>Lead Abatement Work Plan</div>
              {insp.work_plan_data?.reviewed && (
                <span style={{background:'#D1FAE5',color:'#065F46',border:'1px solid #6EE7B7',borderRadius:'20px',padding:'2px 10px',fontSize:'11px',fontWeight:'600'}}>
                  ✓ Reviewed {new Date(insp.work_plan_data.reviewedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}
                </span>
              )}
            </div>
            <div style={{fontSize:'12px',color:'#64748B',marginBottom:'16px'}}>
              {insp.work_plan_data
                ? `Work Plan ${insp.work_plan_data.workPlanNumber} generated · ${insp.work_plan_data.overallRemediationLevel} · ${insp.work_plan_data.totalAffectedSqft} sq ft · ${new Date(insp.work_plan_data.generatedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`
                : 'Claude reads the full assessment and generates a complete NYS-compliant Work Plan per 2 NYCRR Part 56, NYC Local Law 61, and NYC DOH Guidelines — with remediation procedures, containment specs, and PPE requirements.'}
            </div>
            {workPlanStatus === 'generating' && (
              <div style={{background:'#EFF6FF',border:'1px solid #BFDBFE',borderRadius:'8px',padding:'10px 16px',marginBottom:'12px',fontSize:'13px',color:'#1E40AF',display:'flex',alignItems:'center',gap:'8px'}}>
                <div style={{width:'10px',height:'10px',border:'2px solid #1E40AF',borderTopColor:'transparent',borderRadius:'50%',animation:'spin 0.7s linear infinite',flexShrink:0}}></div>
                Analyzing inspection data against NYC DOH / IICRC S520 guidelines…
              </div>
            )}
            <div style={{display:'flex',gap:'10px',alignItems:'center',flexWrap:'wrap'}}>
              <button
                onClick={generateWorkPlan}
                disabled={workPlanStatus === 'generating'}
                style={{background:'#0E2A50',color:'white',border:'none',borderRadius:'8px',padding:'10px 18px',fontSize:'13px',fontWeight:'500',cursor:workPlanStatus==='generating'?'not-allowed':'pointer',opacity:workPlanStatus==='generating'?0.7:1}}
              >
                {workPlanStatus === 'generating' ? 'Generating…' : insp.work_plan_data ? '↺ Regenerate Work Plan' : '⊞ Generate Work Plan'}
              </button>
              {(insp.work_plan_data?.contentHtml || insp.work_plan_data?.html) && (
                <a
                  href={`/api/work-plan-pdf/${id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{background:'#F8FAFC',color:'#185FA5',border:'1px solid #E2E8F0',borderRadius:'8px',padding:'10px 18px',fontSize:'13px',fontWeight:'500',textDecoration:'none',display:'inline-block'}}
                >
                  ↓ Download PDF
                </a>
              )}
              {(insp.work_plan_data?.contentHtml || insp.work_plan_data?.html) && !insp.work_plan_data?.reviewed && (
                <button
                  onClick={markWorkPlanReviewed}
                  disabled={reviewing}
                  style={{background:'#059669',color:'white',border:'none',borderRadius:'8px',padding:'10px 18px',fontSize:'13px',fontWeight:'500',cursor:reviewing?'not-allowed':'pointer',opacity:reviewing?0.7:1}}
                >
                  {reviewing ? 'Sending…' : '✓ Mark as Reviewed & Send'}
                </button>
              )}
              {(insp.work_plan_data?.contentHtml || insp.work_plan_data?.html) && (
                <button
                  onClick={() => setShowPreview(p => !p)}
                  style={{background:'none',color:'#64748B',border:'1px solid #E2E8F0',borderRadius:'8px',padding:'10px 18px',fontSize:'13px',cursor:'pointer',marginLeft:'auto'}}
                >
                  {showPreview ? '▲ Hide Preview' : '▼ Preview Work Plan'}
                </button>
              )}
            </div>
            {showPreview && (insp.work_plan_data?.contentHtml || insp.work_plan_data?.html) && (
              <div style={{marginTop:'16px',borderTop:'1px solid #E2E8F0',paddingTop:'16px'}}>
                <iframe
                  srcDoc={insp.work_plan_data.contentHtml || insp.work_plan_data.html}
                  style={{width:'100%',height:'640px',border:'1px solid #E2E8F0',borderRadius:'8px',background:'white'}}
                  title="Work Plan Preview"
                  sandbox="allow-same-origin"
                />
              </div>
            )}
          </div>

          {/* Downloads + Review + Reset */}
          <div style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:'16px 24px',marginBottom:'16px',display:'flex',gap:'10px',flexWrap:'wrap',alignItems:'center'}}>
            {insp.report_html && (
              <a href={`/api/report-pdf/${id}`} target="_blank" rel="noopener noreferrer" style={{background:'#F8FAFC',color:'#185FA5',border:'1px solid #E2E8F0',borderRadius:'8px',padding:'9px 16px',fontSize:'13px',fontWeight:'500',textDecoration:'none'}}>↓ Download Report PDF</a>
            )}
            {insp.report_html && (
              <a href={`/review/${id}?type=report`} style={{background:'#EFF6FF',color:'#1E40AF',border:'1px solid #BFDBFE',borderRadius:'8px',padding:'9px 16px',fontSize:'13px',fontWeight:'500',textDecoration:'none'}}>✎ Review & Refine Report</a>
            )}
            {hasWorkPlan && (
              <a href={`/review/${id}?type=workplan`} style={{background:'#F0FDF4',color:'#166534',border:'1px solid #86EFAC',borderRadius:'8px',padding:'9px 16px',fontSize:'13px',fontWeight:'500',textDecoration:'none'}}>✎ Review & Refine Work Plan</a>
            )}
            <button onClick={()=>updateStatus('pending')} disabled={updating} style={{background:'none',color:'#94A3B8',border:'1px solid #E2E8F0',borderRadius:'8px',padding:'9px 16px',fontSize:'13px',cursor:'pointer',marginLeft:'auto'}}>Reset to Pending</button>
          </div>

          {/* Summary */}
          <div style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:'20px 24px'}}>
            <div style={{fontSize:'14px',fontWeight:'500',marginBottom:'16px',color:'#0F172A'}}>Inspection Summary</div>
            {fd.affectedAreas?.length>0&&(
              <div style={{marginBottom:'16px'}}>
                <div style={{fontSize:'11px',fontWeight:'600',color:'#94A3B8',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:'8px'}}>Affected Areas ({fd.affectedAreas.length})</div>
                {fd.affectedAreas.map((a,i)=>(
                  <div key={i} style={{padding:'10px 12px',background:'#F8FAFC',borderRadius:'8px',marginBottom:'6px',fontSize:'13px'}}>
                    <span style={{fontWeight:'500'}}>{a.room}{a.detail?` — ${a.detail}`:''}</span>
                    {a.severity&&<span style={{marginLeft:'8px',fontSize:'11px',color:'#64748B'}}>{a.severity}</span>}
                    {a.mc&&<span style={{marginLeft:'8px',fontSize:'11px',color:'#64748B'}}>MC: {a.mc}%</span>}
                  </div>
                ))}
              </div>
            )}
            <div style={{fontSize:'11px',fontWeight:'600',color:'#94A3B8',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:'4px'}}>Overall Risk</div>
            <div style={{fontSize:'13px',color:'#334155'}}>{fd.riskLevel||'—'}</div>
          </div>
        </div>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </>
  )
}
