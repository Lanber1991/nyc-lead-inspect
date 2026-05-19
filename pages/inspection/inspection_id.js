import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'

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
  const [cocStatus, setCocStatus] = useState('')
  const [labResults, setLabResults] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [cocDragging, setCocDragging] = useState(false)

  useEffect(() => { if (id) fetchInspection() }, [id])

  async function fetchInspection() {
    setLoading(true)
    const res = await fetch(`/api/inspections/${id}`)
    if (res.ok) {
      const data = await res.json()
      setInsp(data)
      if (data.lab_data) setLabResults(data.lab_data)
    }
    setLoading(false)
  }

  function showMsg(text, type='success') {
    setMsg(text); setMsgType(type)
    setTimeout(() => setMsg(''), 4000)
  }

  async function patchLabData(patch) {
    const current = labResults || {}
    const merged = { ...current, ...patch }
    const res = await fetch('/api/inspections', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, lab_data: merged })
    })
    if (res.ok) {
      setLabResults(merged)
      await fetchInspection()
    }
    return res.ok
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
        const labData = {
          ...(labResults || {}),
          samples: extracted.samples,
          narrative: interpreted.narrative,
          processedAt: new Date().toISOString(),
          source: 'drag-drop',
          cocNumber: extracted.cocNumber || labResults?.cocNumber || '',
          projectAddress: extracted.projectAddress || labResults?.projectAddress || '',
          labPdfBase64: base64,
        }
        await fetch('/api/inspections', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, status: 'lab_received', lab_data: labData })
        })
        setLabResults(labData); setLabStatus('')
        showMsg('Lab results extracted and saved')
        await fetchInspection()
      } catch(err) { setLabStatus(''); showMsg(`Error: ${err.message}`, 'error') }
    }
    reader.readAsDataURL(file)
  }

  async function processCocPdf(file) {
    if (!file || file.type !== 'application/pdf') { showMsg('Please use a PDF file', 'error'); return }
    setCocStatus('Saving COC PDF...')
    const reader = new FileReader()
    reader.onload = async (e) => {
      const base64 = e.target.result.split(',')[1]
      try {
        const ok = await patchLabData({ cocPdfBase64: base64 })
        setCocStatus('')
        if (ok) showMsg('COC PDF saved — will be appended to report')
        else showMsg('Failed to save COC PDF', 'error')
      } catch(err) { setCocStatus(''); showMsg(`Error: ${err.message}`, 'error') }
    }
    reader.readAsDataURL(file)
  }

  function onDrop(e) { e.preventDefault(); setDragging(false); processLabPdf(e.dataTransfer.files[0]) }
  function onCocDrop(e) { e.preventDefault(); setCocDragging(false); processCocPdf(e.dataTransfer.files[0]) }

  function formatDate(d) {
    if (!d) return '—'
    try { return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' }) }
    catch(e) { return d }
  }

  if (loading) return <div style={{padding:'48px',textAlign:'center',fontFamily:'system-ui,sans-serif',color:'#94A3B8'}}>Loading…</div>
  if (!insp) return <div style={{padding:'48px',textAlign:'center',fontFamily:'system-ui,sans-serif'}}>Not found. <a href="/" style={{color:'#185FA5'}}>Back</a></div>

  const s = STATUS_COLORS[insp.status] || STATUS_COLORS.pending
  const fd = insp.form_data || {}
  const hasCocPdf = !!(labResults?.cocPdfBase64)
  const hasLabPdf = !!(labResults?.labPdfBase64)

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
        <div style={{maxWidth:'800px',margin:'0 auto',padding:'24px 16px'}}>
          {msg && <div style={{background:msgType==='error'?'#FEE2E2':'#D1FAE5',color:msgType==='error'?'#991B1B':'#065F46',border:`1px solid ${msgType==='error'?'#FCA5A5':'#6EE7B7'}`,borderRadius:'8px',padding:'10px 16px',marginBottom:'16px',fontSize:'13px'}}>{msg}</div>}

          {/* Property */}
          <div style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:'20px 24px',marginBottom:'16px'}}>
            <div style={{fontSize:'20px',fontWeight:'600',color:'#0F172A',marginBottom:'4px'}}>{insp.property_address}</div>
            <div style={{fontSize:'14px',color:'#64748B',marginBottom:'16px'}}>{insp.property_city} {insp.property_state_zip}</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'16px'}}>
              {[
                {label:'Client',value:insp.client_name},
                {label:'Inspector',value:insp.inspector_name},
                {label:'Date',value:formatDate(insp.inspection_date)},
                {label:'Purpose',value:fd.purpose},
                {label:'COC #',value:labResults?.cocNumber||fd.cocNumber||'—'},
                {label:'Submitted',value:new Date(insp.submitted_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}
              ].map(f=>(
                <div key={f.label}>
                  <div style={{fontSize:'11px',fontWeight:'600',color:'#94A3B8',textTransform:'uppercase',letterSpacing:'0.5px'}}>{f.label}</div>
                  <div style={{fontSize:'13px',color:'#334155',marginTop:'3px'}}>{f.value||'—'}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Lab Results Drop Zone */}
          <div style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:'20px 24px',marginBottom:'16px'}}>
            <div style={{fontSize:'14px',fontWeight:'600',marginBottom:'4px',color:'#0F172A'}}>Lab Report (EMSL PDF)</div>
            <div style={{fontSize:'12px',color:'#64748B',marginBottom:'16px'}}>
              {labResults?.samples ? 'Results processed — PDF saved and will be appended to the final report.' : 'Drop the EMSL PDF here — Claude will extract results and save the PDF as an appendix.'}
            </div>
            {labStatus && (
              <div style={{background:'#EFF6FF',border:'1px solid #BFDBFE',borderRadius:'8px',padding:'10px 16px',marginBottom:'12px',fontSize:'13px',color:'#1E40AF',display:'flex',alignItems:'center',gap:'8px'}}>
                <div style={{width:'10px',height:'10px',border:'2px solid #1E40AF',borderTopColor:'transparent',borderRadius:'50%',animation:'spin 0.7s linear infinite',flexShrink:0}}></div>
                {labStatus}
              </div>
            )}
            {!labResults?.samples ? (
              <div
                onDragOver={e=>{e.preventDefault();setDragging(true)}}
                onDragLeave={()=>setDragging(false)}
                onDrop={onDrop}
                onClick={()=>document.getElementById('labFileInput').click()}
                style={{border:`2px dashed ${dragging?'#185FA5':'#CBD5E1'}`,borderRadius:'10px',padding:'40px',textAlign:'center',cursor:'pointer',background:dragging?'#EFF6FF':'#F8FAFC',transition:'all 0.15s'}}>
                <div style={{fontSize:'32px',marginBottom:'8px'}}>📄</div>
                <div style={{fontSize:'14px',fontWeight:'500',color:dragging?'#185FA5':'#475569'}}>{dragging?'Drop to process':'Drop EMSL PDF here'}</div>
                <div style={{fontSize:'12px',color:'#94A3B8',marginTop:'4px'}}>or tap to browse</div>
                <input type="file" id="labFileInput" accept="application/pdf" style={{display:'none'}} onChange={e=>processLabPdf(e.target.files[0])} />
              </div>
            ) : (
              <div>
                <div style={{background:'#F0FDF4',border:'1px solid #86EFAC',borderRadius:'8px',padding:'12px 16px',marginBottom:'12px'}}>
                  <div style={{fontSize:'12px',fontWeight:'600',color:'#166534',marginBottom:'4px'}}>
                    ✓ {labResults.samples?.length||0} sample(s) extracted · {hasLabPdf ? 'PDF saved' : 'PDF not saved'} · {new Date(labResults.processedAt).toLocaleDateString('en-US',{month:'short',day:'numeric'})}
                  </div>
                  {(labResults.cocNumber||labResults.projectAddress)&&(
                    <div style={{fontSize:'12px',color:'#166534',marginBottom:'8px',paddingBottom:'6px',borderBottom:'1px solid #BBF7D0'}}>
                      {labResults.cocNumber&&<span>COC #{labResults.cocNumber}</span>}
                      {labResults.cocNumber&&labResults.projectAddress&&<span> · </span>}
                      {labResults.projectAddress&&<span>{labResults.projectAddress}</span>}
                    </div>
                  )}
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
          </div>

          {/* COC PDF Upload */}
          <div style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:'20px 24px',marginBottom:'16px'}}>
            <div style={{fontSize:'14px',fontWeight:'600',marginBottom:'4px',color:'#0F172A'}}>Chain of Custody (COC PDF)</div>
            <div style={{fontSize:'12px',color:'#64748B',marginBottom:'16px'}}>
              {hasCocPdf ? 'COC PDF saved — will be appended to the final report before the license.' : 'Drop the COC PDF here to append it to the final report.'}
            </div>
            {cocStatus && (
              <div style={{background:'#EFF6FF',border:'1px solid #BFDBFE',borderRadius:'8px',padding:'10px 16px',marginBottom:'12px',fontSize:'13px',color:'#1E40AF',display:'flex',alignItems:'center',gap:'8px'}}>
                <div style={{width:'10px',height:'10px',border:'2px solid #1E40AF',borderTopColor:'transparent',borderRadius:'50%',animation:'spin 0.7s linear infinite',flexShrink:0}}></div>
                {cocStatus}
              </div>
            )}
            {!hasCocPdf ? (
              <div
                onDragOver={e=>{e.preventDefault();setCocDragging(true)}}
                onDragLeave={()=>setCocDragging(false)}
                onDrop={onCocDrop}
                onClick={()=>document.getElementById('cocFileInput').click()}
                style={{border:`2px dashed ${cocDragging?'#185FA5':'#CBD5E1'}`,borderRadius:'10px',padding:'32px',textAlign:'center',cursor:'pointer',background:cocDragging?'#EFF6FF':'#F8FAFC',transition:'all 0.15s'}}>
                <div style={{fontSize:'32px',marginBottom:'8px'}}>📋</div>
                <div style={{fontSize:'14px',fontWeight:'500',color:cocDragging?'#185FA5':'#475569'}}>{cocDragging?'Drop to save':'Drop COC PDF here'}</div>
                <div style={{fontSize:'12px',color:'#94A3B8',marginTop:'4px'}}>or tap to browse</div>
                <input type="file" id="cocFileInput" accept="application/pdf" style={{display:'none'}} onChange={e=>processCocPdf(e.target.files[0])} />
              </div>
            ) : (
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',background:'#F0FDF4',border:'1px solid #86EFAC',borderRadius:'8px',padding:'12px 16px'}}>
                <div style={{fontSize:'12px',fontWeight:'600',color:'#166534'}}>✓ COC PDF attached — will appear before license in final report</div>
                <button
                  onClick={async()=>{ await patchLabData({ cocPdfBase64: null }); showMsg('COC PDF removed') }}
                  style={{fontSize:'12px',color:'#64748B',border:'1px solid #E2E8F0',borderRadius:'6px',padding:'4px 10px',background:'white',cursor:'pointer'}}>
                  Remove
                </button>
              </div>
            )}
          </div>

          {/* Appendix status summary */}
          {(hasLabPdf || hasCocPdf) && (
            <div style={{background:'#EFF6FF',border:'1px solid #BFDBFE',borderRadius:'10px',padding:'14px 18px',marginBottom:'16px',fontSize:'12px',color:'#1E3A5F'}}>
              <div style={{fontWeight:'700',marginBottom:'6px',fontSize:'11px',letterSpacing:'0.5px',textTransform:'uppercase',color:'#185FA5'}}>Report Appendix Order</div>
              <div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
                <span>1. Main report</span>
                {hasCocPdf && <span>2. Chain of Custody (COC)</span>}
                {hasLabPdf && <span>{hasCocPdf?'3':'2'}. EMSL Lab Report</span>}
                <span>{[hasLabPdf,hasCocPdf].filter(Boolean).length+2}. Inspector License</span>
              </div>
            </div>
          )}

          {/* Actions */}
          <div style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:'20px 24px',marginBottom:'16px'}}>
            <div style={{fontSize:'14px',fontWeight:'500',marginBottom:'16px',color:'#0F172A'}}>Actions</div>
            <div style={{display:'flex',gap:'10px',flexWrap:'wrap'}}>
              {insp.status==='pending'&&<button onClick={()=>updateStatus('lab_received')} disabled={updating} style={{background:'#1D4ED8',color:'white',border:'none',borderRadius:'8px',padding:'10px 18px',fontSize:'13px',fontWeight:'500',cursor:'pointer'}}>✓ Mark Lab Received</button>}
              {(insp.status==='lab_received'||insp.status==='pending')&&<button onClick={()=>window.open(`/form.html`,`_blank`)} disabled={updating} style={{background:'#185FA5',color:'white',border:'none',borderRadius:'8px',padding:'10px 18px',fontSize:'13px',fontWeight:'500',cursor:'pointer'}}>✦ Open & Generate Report</button>}
              {insp.status==='lab_received'&&<button onClick={()=>updateStatus('complete')} disabled={updating} style={{background:'#059669',color:'white',border:'none',borderRadius:'8px',padding:'10px 18px',fontSize:'13px',fontWeight:'500',cursor:'pointer'}}>✓ Mark Complete</button>}
              <button onClick={()=>updateStatus('pending')} disabled={updating} style={{background:'none',color:'#64748B',border:'1px solid #E2E8F0',borderRadius:'8px',padding:'10px 18px',fontSize:'13px',cursor:'pointer'}}>Reset to Pending</button>
            </div>
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
