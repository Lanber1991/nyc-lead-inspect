import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

export const maxDuration = 60
export const config = { api: { responseLimit: '10mb' } }

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const WORK_PLAN_SYSTEM = `You are a NYS licensed lead inspector preparing a formal Lead Abatement Work Plan.

REGULATORY FRAMEWORK: This Work Plan is governed by the following standards — reference them where relevant but do not over-cite:
- NYC Local Law 1 of 2004 (as amended): the primary NYC law governing lead paint hazards in pre-1960 residential dwellings. Requires identification and remediation of lead paint hazards.
- HUD Guidelines for the Evaluation and Control of Lead-Based Paint Hazards in Housing (2012): the federal technical reference for abatement work practices, containment, clearance, and disposal.
- EPA RRP Rule (40 CFR Part 745): governs renovation, repair, and painting activities that disturb lead paint in pre-1978 housing. Requires EPA-certified contractors and prescribed work practices.
- NYS Public Health Law Article 13-L and 10 NYCRR Part 67: NYS licensing for lead inspectors, risk assessors, and abatement supervisors/workers.
You may use industry-standard technical guidance to fill any technical gaps not covered by the above, but do not reference or cite any specific standards by name beyond those listed.

ABATEMENT METHODS:
Paint removal: Strip or chemically remove all lead paint from the component. HEPA vacuum residue; wet wipe with damp cloth. Refinish as needed.
Encapsulation: Apply an EPA-approved encapsulant over intact lead paint. Only appropriate where paint is well-adhered and the surface will not be subject to friction or impact.
Component replacement: Remove and replace entire painted component (window, door, trim). Preferred method for friction/impact surfaces. All removed components treated as lead waste.
Interim controls (not abatement): Paint stabilization, specialized cleaning, and temporary barriers. Reduces exposure but does not permanently eliminate hazard.

PPE REQUIREMENTS:
Minimal disturbance (<2 sq ft): N100 half-face respirator, disposable Tyvek coverall, nitrile gloves, eye protection.
Moderate disturbance (2–20 sq ft): Full-face N100 or P100 respirator, Tyvek coverall with hood and taped seams, double nitrile gloves, boot covers, eye protection.
Large-scale abatement (>20 sq ft or whole unit): Full-face P100 or supplied-air respirator, full Tyvek suit with taped seams, double gloves, boot covers. Medical surveillance required.

CONTAINMENT REQUIREMENTS (EPA RRP):
Small-scale: Plastic sheeting on floor extending min 6 ft from work area. Close/cover HVAC registers. Post warning signs.
Large-scale: Floor-to-ceiling poly containment on all sides of work area. HEPA air filtration unit with negative pressure. Single entry/exit with decon area. Post lead warning signs at all entry points.

CLEARANCE CRITERIA (EPA/NYC):
Dust wipe clearance: Floors ≤10 μg/ft²; Interior window sills ≤100 μg/ft²; Window troughs ≤100 μg/ft².
Visual: No visible paint chips, dust, or debris in work area or adjacent spaces.
Clearance testing must be performed by a licensed lead inspector or risk assessor independent of the abatement contractor.

WASTE DISPOSAL:
Lead paint waste (chips, dust, components) must be disposed of as regulated waste per EPA and local requirements. Double-bagged in 6-mil poly bags, labeled "CAUTION: LEAD PAINT WASTE." Transport by licensed waste hauler to approved facility.

CONCISENESS RULE: All text fields in your JSON response must be 1-2 sentences maximum. No preambles, no filler, no repetition of data already in the structured fields. Write like a professional report, not a chatbot.

Respond ONLY with a valid JSON object. No other text, no markdown, no code fences.`

function classifyArea(area) {
  const chars = (area.characteristics || '').toLowerCase()
  const severity = (area.severity || '').toLowerCase()
  const material = (area.material || '').toLowerCase()
  const highSeverity = severity.includes('moderate') || severity.includes('high')
  const deteriorated = chars.includes('deteriorat') || chars.includes('peeling') || chars.includes('chipping') || chars.includes('active')
  const frictionSurface = material.includes('window') || material.includes('door') || (area.room || '').toLowerCase().includes('window')
  if (highSeverity || deteriorated || frictionSurface) return 'Full Remediation Required'
  return 'Investigate / Monitor'
}

async function callClaudeForWorkPlan(fd, labData, insp) {
  const areas = fd.affectedAreas || []
  const airSamples = fd.airSamples || []

  const inspectionSummary = {
    property: `${fd.propAddr || insp.property_address}, ${insp.property_city} ${insp.property_state_zip}`,
    propertyType: fd.propType || '',
    yearBuilt: fd.yearBuilt || '',
    sqft: fd.sqft || '',
    inspectionDate: insp.inspection_date,
    inspector: insp.inspector_name,
    inspectorCert: fd.inspCert || '',
    client: insp.client_name || '',
    purpose: insp.purpose || '',
    overallRisk: fd.riskLevel || '',
    occupancy: fd.occupancyStatus || '',
    vulnerableOccupants: fd.vulnerableOccupants || '',
    moistureDuration: fd.moistureDuration || '',
    outdoorConditions: `${fd.weather || ''}, ${fd.outdoorTemp || ''}°F, ${fd.outdoorRH || ''}% RH`,
    hvac: {
      type: fd.hvacType || '',
      filterCondition: fd.filterCond || '',
      ductCondition: fd.ductCond || '',
      moldOnVents: fd.moldOnVents || '',
      servingAffectedArea: fd.hvacServingArea || ''
    },
    affectedAreas: areas.map((a, i) => ({
      room: a.room || '',
      detail: a.detail || '',
      material: a.material || '',
      sqft: a.area || '',
      severity: a.severity || '',
      moistureContent: `${a.mc || ''}% (${a.classification || ''})`,
      moistureSource: a.source || '',
      substrate: a.substrate || '',
      thermalAnomaly: a.ir || '',
      temp: `${a.temp || ''}°F`,
      rh: `${a.rh || ''}%`,
      samplesCollected: Array.isArray(a.sample) ? a.sample.join(', ') : (a.sample || 'none'),
      notes: a.notes || '',
      recommendedAction: (fd.areaActions && fd.areaActions[i]) || classifyArea(a)
    })),
    airSamples: airSamples.map(s => ({
      label: s.label,
      type: s.type,
      location: s.location,
      isOutdoorControl: s.outdoor_control || false
    })),
    labFindings: labData ? {
      samples: labData.samples?.map(s => ({
        id: s.sample_id,
        type: s.sample_type,
        location: s.location,
        results: s.results?.map(r => `${r.species}: ${r.count} ${r.unit || ''}`).join(', '),
        summary: s.raw_summary
      })),
      narrative: labData.narrative?.slice(0, 800)
    } : null,
    recommendations: (fd.recommendations?.items || []).map(r => `[${r.priority}] ${r.text}`)
  }

  const prompt = `Generate a complete NYS Lead Abatement Work Plan for this inspection. Apply the appropriate NYC DOH remediation level and moisture condition to each affected area. Be specific with procedures, measurements, and materials.

INSPECTION DATA:
${JSON.stringify(inspectionSummary, null, 2)}

Respond with this JSON structure exactly:
{
  "workPlanNumber": "WP-${insp.report_number}",
  "projectSummary": "1-2 sentence overview of lead paint findings and scope of abatement work required",
  "overallAbatementScope": "e.g. Component replacement + encapsulation — multiple rooms",
  "totalAffectedSqft": <number>,
  "estimatedDuration": "e.g. 2–3 days",
  "regulatoryBasis": "NYC Local Law 1 of 2004; HUD Guidelines for the Evaluation and Control of Lead-Based Paint Hazards in Housing (2012); EPA RRP Rule (40 CFR Part 745); NYS Public Health Law Article 13-L",
  "areas": [
    {
      "room": "...",
      "component": "e.g. Window sill, Door frame, Baseboard, Wall",
      "abatementMethod": "Paint removal / Encapsulation / Component replacement / Interim controls",
      "sqft": <number>,
      "hazardLevel": "e.g. High — deteriorated lead paint on friction surface",
      "containmentType": "Small-scale / Large-scale",
      "containmentSpec": "Specific setup — poly dimensions, HEPA unit, entry/exit",
      "ppeRequired": "Complete PPE specification for this component",
      "abatementSteps": [
        "Step 1...",
        "Step 2..."
      ],
      "disposal": "Lead waste disposal instructions — bag spec, labeling, transport",
      "clearanceCriteria": "Dust wipe thresholds for this surface type (floor/sill/trough)"
    }
  ],
  "ppeMatrix": "Summary of PPE requirements across all areas of this project",
  "containmentOverview": "Project-wide containment requirements and setup notes",
  "wasteManagement": "Complete lead waste handling, double-bagging, labeling, transport, and disposal protocol",
  "postAbatementClearance": "Dust wipe clearance testing requirements — who performs it, surfaces sampled, pass/fail thresholds",
  "occupantProtection": "Relocation requirements, notification timeline, re-entry criteria, and vulnerable occupant (children under 6, pregnant women) considerations",
  "specialConsiderations": "Friction/impact surfaces, friction components, deteriorated substrate, or other site-specific hazard notes",
  "assessorStatement": "This Lead Abatement Work Plan has been prepared by the undersigned NYS Licensed Lead Inspector in accordance with NYC Local Law 1, the HUD Guidelines, and the EPA RRP Rule. The abatement contractor assigned to this project must be EPA RRP-certified and must review and acknowledge this Work Plan prior to commencing work. Post-abatement clearance testing must be performed by an independent licensed lead inspector or risk assessor."
}`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8000,
      system: WORK_PLAN_SYSTEM,
      messages: [{ role: 'user', content: prompt }]
    })
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Claude API ${res.status}: ${errText.slice(0, 200)}`)
  }
  const data = await res.json()
  const text = data.content?.[0]?.text?.trim() || ''
  const jsonText = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
  return JSON.parse(jsonText)
}

function levelColor(level) {
  if (!level) return { bg: '#F3F4F6', text: '#374151', border: '#D1D5DB' }
  if (level.includes('4')) return { bg: '#FEE2E2', text: '#991B1B', border: '#FCA5A5' }
  if (level.includes('3')) return { bg: '#FEF3C7', text: '#92400E', border: '#FCD34D' }
  if (level.includes('2')) return { bg: '#DBEAFE', text: '#1E40AF', border: '#93C5FD' }
  return { bg: '#D1FAE5', text: '#065F46', border: '#6EE7B7' }
}

function buildCoverHTML(insp, wp) {
  const fd = insp.form_data || {}
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  let logoDataUri = ''
  try {
    const logoBuf = fs.readFileSync(path.join(process.cwd(), 'public', 'logo.png'))
    logoDataUri = `data:image/png;base64,${logoBuf.toString('base64')}`
  } catch (e) {}

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>* { box-sizing: border-box; margin: 0; padding: 0; } body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; } @page { margin: 0; size: Letter; } @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }</style></head><body>
<div style="background:#0E2A50;min-height:100vh;padding:60px 50px;color:white;display:flex;flex-direction:column;">
  ${logoDataUri
    ? `<div style="background:white;border-radius:8px;padding:16px 24px;display:block;margin:0 auto 8px;text-align:center;width:fit-content"><img src="${logoDataUri}" style="height:120px;display:block" /></div>`
    : `<div style="font-size:11pt;color:#93C5FD;font-weight:600;letter-spacing:1px;text-transform:uppercase">NYC Lead Inspections</div>`
  }
  <div style="font-size:11pt;color:#93C5FD;margin-top:80px;letter-spacing:2px;text-transform:uppercase;font-weight:600">Lead Abatement</div>
  <div style="font-size:30pt;font-weight:300;margin-top:10px"><strong style="font-weight:700">Work Plan</strong></div>
  <div style="width:80px;height:3px;background:#185FA5;margin:20px 0 40px;"></div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:40px;border-top:1px solid rgba(255,255,255,0.2);padding-top:30px;margin-top:auto">
    <div>
      <div style="font-size:8pt;color:#93C5FD;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Property</div>
      <div style="font-size:13pt;font-weight:500">${fd.propAddr || insp.property_address}</div>
      <div style="font-size:9pt;color:#BAD4F5;margin-top:2px">${insp.property_city} ${insp.property_state_zip}</div>
      <div style="margin-top:16px">
        <div style="font-size:8pt;color:#93C5FD;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Client</div>
        <div style="font-size:13pt;font-weight:500">${insp.client_name || ''}</div>
      </div>
    </div>
    <div>
      <div style="font-size:8pt;color:#93C5FD;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Work Plan Number</div>
      <div style="font-size:13pt;font-weight:500">${wp.workPlanNumber}</div>
      <div style="margin-top:16px">
        <div style="font-size:8pt;color:#93C5FD;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Prepared By</div>
        <div style="font-size:13pt;font-weight:500">${insp.inspector_name}</div>
        <div style="font-size:9pt;color:#BAD4F5;margin-top:2px">Lead Inspector — NYS DOL · Lic. #${fd.inspCert || ''}</div>
      </div>
      <div style="margin-top:16px">
        <div style="font-size:8pt;color:#93C5FD;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Date Prepared</div>
        <div style="font-size:13pt;font-weight:500">${today}</div>
      </div>
    </div>
  </div>
  <div style="margin-top:30px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:12px 16px;font-size:9pt;color:#BAD4F5;line-height:1.6">
    This Work Plan has been prepared pursuant to NYC Local Law 1 of 2004, the HUD Guidelines, and the EPA RRP Rule. The remediation contractor must review and sign this plan before commencing work. Per NYS law, the lead inspector and abatement contractor must be separate, unaffiliated entities. Post-abatement clearance testing must be conducted by an independent licensed lead inspector or risk assessor.
  </div>
  <div style="text-align:center;font-size:8pt;color:#4A6FA8;padding:16px 0 0;margin-top:24px;border-top:1px solid rgba(255,255,255,0.1)">NYC Lead Inspections &nbsp;·&nbsp; 208 Meserole Street, Brooklyn NY 11206 &nbsp;·&nbsp; (646) 496-7039 &nbsp;·&nbsp; info@nycleadinspections.com &nbsp;·&nbsp; www.nycleadinspections.com</div>
</div>
</body></html>`
}

function buildContentHTML(insp, wp) {
  const fd = insp.form_data || {}
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const overallColors = levelColor(wp.overallRemediationLevel)

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 11pt; color: #1a1a1a; line-height: 1.5; padding-bottom: 36px; }
  .page { page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  .sec-head { background: #0E2A50; color: white; padding: 14px 16px; border-radius: 4px; margin-bottom: 16px; break-inside: avoid; break-after: avoid; }
  .sec-head-title { font-size: 11pt; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; }
  .sec-head-sub { font-size: 9pt; color: #93C5FD; margin-top: 3px; }
  .field-row { display: flex; align-items: stretch; border-bottom: 1px solid #F1F5F9; }
  .field-row:last-child { border-bottom: none; }
  .field-label { background: #F8FAFC; padding: 7px 12px; font-size: 9pt; font-weight: 600; color: #64748B; width: 38%; flex-shrink: 0; overflow-wrap: break-word; word-break: break-word; }
  .field-value { padding: 7px 12px; font-size: 10pt; color: #0F172A; flex: 1; overflow-wrap: break-word; word-break: break-word; }
  .fields-table { border: 1px solid #E2E8F0; border-radius: 6px; overflow: visible; margin-bottom: 14px; break-inside: avoid; }
  .area-card { border: 1px solid #E2E8F0; border-radius: 6px; padding: 16px; margin-bottom: 16px; break-inside: avoid; }
  .area-title { font-size: 12pt; font-weight: 700; color: #0F172A; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid #E2E8F0; overflow-wrap: break-word; word-break: break-word; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 10px; font-size: 9pt; font-weight: 600; }
  .steps-list { margin: 8px 0 0 0; padding-left: 0; list-style: none; counter-reset: step-counter; }
  .steps-list li { padding: 5px 0 5px 20px; border-bottom: 1px solid #F8FAFC; font-size: 10pt; color: #1E293B; position: relative; line-height: 1.5; counter-increment: step-counter; overflow-wrap: break-word; word-break: break-word; }
  .steps-list li:before { content: counter(step-counter); position: absolute; left: 0; top: 5px; background: #185FA5; color: white; width: 14px; height: 14px; border-radius: 50%; font-size: 8pt; font-weight: 700; display: flex; align-items: center; justify-content: center; line-height: 1; }
  .steps-list li:last-child { border-bottom: none; }
  .info-block { background: #EFF6FF; border-left: 3px solid #185FA5; border-radius: 0 6px 6px 0; padding: 12px 16px; margin: 10px 0; font-size: 10pt; color: #1E3A5F; line-height: 1.6; overflow-wrap: break-word; word-break: break-word; }
  .warn-block { background: #FEF3C7; border-left: 3px solid #D97706; border-radius: 0 6px 6px 0; padding: 12px 16px; margin: 10px 0; font-size: 10pt; color: #78350F; line-height: 1.6; overflow-wrap: break-word; word-break: break-word; }
  .cert-block { border: 2px solid #0E2A50; border-radius: 8px; padding: 20px 24px; margin-top: 20px; break-inside: avoid; }
  .sig-line { border-top: 1px solid #334155; margin-top: 40px; padding-top: 6px; font-size: 9pt; color: #64748B; }
  .sub-label { font-size: 9pt; font-weight: 700; color: #185FA5; text-transform: uppercase; letter-spacing: 0.5px; margin: 12px 0 6px; break-after: avoid; }
  .level-badge { display: inline-block; padding: 4px 14px; border-radius: 20px; font-size: 10pt; font-weight: 700; }
  .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; break-inside: avoid; }
  .summary-stat { background: #EFF6FF; border-radius: 6px; padding: 12px 16px; text-align: center; }
  .summary-stat-num { font-size: 16pt; font-weight: 700; color: #185FA5; }
  .summary-stat-label { font-size: 8pt; color: #64748B; margin-top: 2px; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>

<!-- PROJECT OVERVIEW -->
<div class="page">
  <div class="sec-head">
    <div class="sec-head-title">Project Overview</div>
    <div class="sec-head-sub">${fd.propAddr || insp.property_address} · Assessment Report #${insp.report_number}</div>
  </div>

  <div class="summary-grid">
    <div class="summary-stat">
      <div class="summary-stat-num">${wp.areas?.length || 0}</div>
      <div class="summary-stat-label">Areas</div>
    </div>
    <div class="summary-stat">
      <div class="summary-stat-num">${wp.totalAffectedSqft || ''}</div>
      <div class="summary-stat-label">Total Sq Ft</div>
    </div>
    <div class="summary-stat">
      <div class="summary-stat-num" style="font-size:10pt">${(wp.overallAbatementScope || '').split('—')[0].trim()}</div>
      <div class="summary-stat-label">Abatement Scope</div>
    </div>
    <div class="summary-stat">
      <div class="summary-stat-num">${wp.estimatedDuration || ''}</div>
      <div class="summary-stat-label">Est. Duration</div>
    </div>
  </div>

  <div class="fields-table">
    <div class="field-row"><div class="field-label">Property Address</div><div class="field-value">${fd.propAddr || insp.property_address}, ${insp.property_city} ${insp.property_state_zip}</div></div>
    <div class="field-row"><div class="field-label">Client</div><div class="field-value">${insp.client_name || ''}</div></div>
    <div class="field-row"><div class="field-label">Inspector / Assessor</div><div class="field-value">${insp.inspector_name} · Lic. #${fd.inspCert || ''}</div></div>
    <div class="field-row"><div class="field-label">Assessment Date</div><div class="field-value">${insp.inspection_date}</div></div>
    <div class="field-row"><div class="field-label">Assessment Report #</div><div class="field-value">${insp.report_number}</div></div>
    <div class="field-row"><div class="field-label">Work Plan Number</div><div class="field-value">${wp.workPlanNumber}</div></div>
    <div class="field-row"><div class="field-label">Regulatory Basis</div><div class="field-value">${wp.regulatoryBasis}</div></div>
    <div class="field-row"><div class="field-label">Overall Abatement Scope</div><div class="field-value">${wp.overallAbatementScope || ''}</div></div>
  </div>

  <div class="info-block"><!-- REFINE:projectSummary:start -->${wp.projectSummary}<!-- REFINE:projectSummary:end --></div>

  ${wp.occupantProtection ? `<div class="warn-block"><strong>Occupant Protection:</strong> <!-- REFINE:occupantProtection:start -->${wp.occupantProtection}<!-- REFINE:occupantProtection:end --></div>` : `<!-- REFINE:occupantProtection:start --><!-- REFINE:occupantProtection:end -->`}

  ${wp.specialConsiderations ? `<div class="warn-block"><strong>Special Considerations:</strong> <!-- REFINE:specialConsiderations:start -->${wp.specialConsiderations}<!-- REFINE:specialConsiderations:end --></div>` : `<!-- REFINE:specialConsiderations:start --><!-- REFINE:specialConsiderations:end -->`}

  <div class="sub-label">Component Summary</div>
  <div class="fields-table">
    <div class="field-row" style="background:#F8FAFC">
      <div class="field-label" style="width:30%">Room / Component</div>
      <div class="field-value" style="width:15%;flex:none;border-right:1px solid #F1F5F9">Sq Ft</div>
      <div class="field-value" style="width:25%;flex:none;border-right:1px solid #F1F5F9">Method</div>
      <div class="field-value">Containment</div>
    </div>
    ${(wp.areas || []).map(a => {
      const c = levelColor(a.hazardLevel)
      return `<div class="field-row">
        <div class="field-label" style="width:30%">${a.room}${a.component ? ' — ' + a.component : ''}</div>
        <div class="field-value" style="width:15%;flex:none;border-right:1px solid #F1F5F9">${a.sqft} sf</div>
        <div class="field-value" style="width:25%;flex:none;border-right:1px solid #F1F5F9;font-size:9pt">${a.abatementMethod}</div>
        <div class="field-value" style="font-size:9pt">${a.containmentType}</div>
      </div>`
    }).join('')}
  </div>

</div>

<!-- COMPONENT-BY-COMPONENT WORK PLANS -->
<div class="page">
  <div class="sec-head">
    <div class="sec-head-title">Component-by-Component Abatement Scope</div>
    <div class="sec-head-sub">${wp.areas?.length || 0} component(s) · ${wp.totalAffectedSqft || ''} total sq ft</div>
  </div>

  ${(wp.areas || []).map((a, i) => {
    const c = levelColor(a.hazardLevel)
    return `
    <div class="area-card">
      <div class="area-title">
        Component ${i + 1}: ${a.room}${a.component ? ' — ' + a.component : ''}
        <span class="badge" style="margin-left:10px;background:${c.bg};color:${c.text};border:1px solid ${c.border}">${a.abatementMethod}</span>
        <span style="margin-left:8px;font-size:9pt;font-weight:400;color:#64748B">${a.sqft} sq ft</span>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <div class="sub-label">Containment</div>
          <div style="font-size:10pt;color:#1E293B;line-height:1.5">${a.containmentSpec}</div>
        </div>
        <div>
          <div class="sub-label">PPE Required</div>
          <div style="font-size:10pt;color:#1E293B;line-height:1.5">${a.ppeRequired}</div>
        </div>
      </div>

      <div class="sub-label">Abatement Procedure</div>
      <ol class="steps-list">
        ${(a.abatementSteps || []).map(step => `<li>${step}</li>`).join('')}
      </ol>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
        <div>
          <div class="sub-label">Lead Waste Disposal</div>
          <div style="font-size:10pt;color:#1E293B;line-height:1.5">${a.disposal}</div>
        </div>
        <div>
          <div class="sub-label">Clearance Criteria</div>
          <div style="font-size:10pt;color:#1E293B;line-height:1.5">${a.clearanceCriteria}</div>
        </div>
      </div>
    </div>`
  }).join('')}

</div>

<!-- SPECIFICATIONS & PROTOCOLS -->
<div class="page">
  <div class="sec-head">
    <div class="sec-head-title">Project Specifications & Protocols</div>
  </div>

  <div class="sub-label">PPE Requirements — Project Summary</div>
  <div class="info-block"><!-- REFINE:ppeMatrix:start -->${wp.ppeMatrix}<!-- REFINE:ppeMatrix:end --></div>

  <div class="sub-label">Containment Specifications</div>
  <div class="info-block"><!-- REFINE:containmentOverview:start -->${wp.containmentOverview}<!-- REFINE:containmentOverview:end --></div>

  <div class="sub-label">Lead Waste Management & Disposal</div>
  <div class="info-block"><!-- REFINE:wasteManagement:start -->${wp.wasteManagement}<!-- REFINE:wasteManagement:end --></div>

  <div class="sub-label">Post-Abatement Clearance Testing</div>
  <div class="info-block"><!-- REFINE:postAbatementClearance:start -->${wp.postAbatementClearance}<!-- REFINE:postAbatementClearance:end --></div>

</div>

<!-- CERTIFICATION PAGE -->
<div class="page">
  <div class="sec-head">
    <div class="sec-head-title">Assessor Certification & Acknowledgment</div>
    <div class="sec-head-sub">NYC Local Law 1 · EPA RRP Compliance</div>
  </div>

  <div class="cert-block">
    <div class="sub-label" style="margin-top:0">Assessor Statement</div>
    <div style="font-size:10pt;color:#1E293B;line-height:1.7;margin-bottom:20px"><!-- REFINE:assessorStatement:start -->${wp.assessorStatement}<!-- REFINE:assessorStatement:end --></div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:40px">
      <div>
        <div class="sig-line">
          <div style="font-weight:600;color:#0F172A">${insp.inspector_name}</div>
          NYS Licensed Lead Inspector
        </div>
        <div style="margin-top:16px">
          <div class="sig-line">
            <div style="color:#94A3B8">License #</div>
            ${fd.inspCert || '___________________'}
          </div>
        </div>
        <div style="margin-top:16px">
          <div class="sig-line">
            <div style="color:#94A3B8">Date</div>
            ${today}
          </div>
        </div>
      </div>
      <div>
        <div style="font-size:9pt;font-weight:700;color:#185FA5;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Abatement Contractor Acknowledgment</div>
        <div style="font-size:9pt;color:#64748B;margin-bottom:20px">By signing below, the EPA RRP-certified abatement contractor confirms receipt of this Work Plan, agrees to perform all remediation in accordance with its specifications, and certifies that they are not affiliated with the assessor per NYS DOL requirements.</div>
        <div class="sig-line">
          <div style="color:#94A3B8">Abatement Contractor</div>
        </div>
        <div style="margin-top:16px">
          <div class="sig-line">
            <div style="color:#94A3B8">License #</div>
          </div>
        </div>
        <div style="margin-top:16px">
          <div class="sig-line">
            <div style="color:#94A3B8">Signature & Date</div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div style="margin-top:20px;font-size:9pt;color:#64748B;line-height:1.6;padding:12px 16px;background:#F8FAFC;border-radius:6px;border:1px solid #E2E8F0">
    <strong>Notice to Property Owner:</strong> This Work Plan is prepared pursuant to New York State law. You have the right to retain a copy of this Work Plan. The remediator must provide you with written notice of the project start date. Upon completion of remediation, post-remediation testing must be conducted by a licensed lead inspector who is independent of the remediator. A copy of the clearance report must be provided to you.
  </div>

</div>

</body>
</html>`
}

async function renderWorkPlanPdf(coverHtml, contentHtml, workPlanNumber) {
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  })

  const coverPage = await browser.newPage()
  await coverPage.setContent(coverHtml, { waitUntil: 'networkidle0' })
  const coverRaw = await coverPage.pdf({
    format: 'Letter', printBackground: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' }
  })

  const headerTpl = `<div style="width:100%;background:#0E2A50;color:white;font-family:Helvetica,Arial,sans-serif;font-size:9pt;display:flex;justify-content:space-between;align-items:center;padding:0 36px;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;height:100%"><span>NYC Lead Inspections &nbsp;·&nbsp; Lead Abatement Work Plan</span><span>${workPlanNumber}</span></div>`
  const footerTpl = `<div style="width:100%;font-family:Helvetica,Arial,sans-serif;font-size:7.5pt;color:#64748B;padding:0 36px;box-sizing:border-box;border-top:1px solid #E2E8F0;text-align:center;display:flex;align-items:center;justify-content:center;height:100%">NYC Lead Inspections &nbsp;·&nbsp; 208 Meserole Street, Brooklyn NY 11206 &nbsp;·&nbsp; (646) 496-7039 &nbsp;·&nbsp; info@nycleadinspections.com &nbsp;·&nbsp; www.nycleadinspections.com</div>`

  const contentPage = await browser.newPage()
  await contentPage.setContent(contentHtml, { waitUntil: 'networkidle0' })
  const contentRaw = await contentPage.pdf({
    format: 'Letter', printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: headerTpl,
    footerTemplate: footerTpl,
    margin: { top: '72px', right: '36px', bottom: '72px', left: '36px' }
  })

  await browser.close()

  const merged = await PDFDocument.create()
  const coverDoc = await PDFDocument.load(Buffer.isBuffer(coverRaw) ? coverRaw : Buffer.from(coverRaw))
  const contentDoc = await PDFDocument.load(Buffer.isBuffer(contentRaw) ? contentRaw : Buffer.from(contentRaw))
  const cp = await merged.copyPages(coverDoc, coverDoc.getPageIndices())
  cp.forEach(p => merged.addPage(p))
  const pp = await merged.copyPages(contentDoc, contentDoc.getPageIndices())
  pp.forEach(p => merged.addPage(p))

  return Buffer.from(await merged.save())
}

async function getGmailAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  })
  const data = await res.json()
  return data.access_token
}

async function sendWorkPlanEmail(pdfBuffer, insp, wp) {
  try {
    const accessToken = await getGmailAccessToken()
    if (!accessToken) return false

    const fd = insp.form_data || {}
    const inspectorEmail = fd.inspEmail || ''
    const pdfBase64 = Buffer.from(pdfBuffer).toString('base64')
    const filename = `Work_Plan_${wp.workPlanNumber}_${insp.property_address.replace(/[^a-z0-9]/gi, '_').slice(0, 30)}.pdf`

    const toAddresses = ['reports@mindfulsolutionsny.com']
    if (inspectorEmail && inspectorEmail !== '—' && inspectorEmail.includes('@')) {
      toAddresses.push(inspectorEmail)
    }

    const boundary = 'boundary_' + Date.now()
    const emailLines = [
      `From: reports@mindfulsolutionsny.com`,
      `To: ${toAddresses.join(', ')}`,
      `Subject: Work Plan Ready: ${wp.workPlanNumber} — ${insp.property_address}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      ``,
      `--${boundary}`,
      `Content-Type: text/html; charset=utf-8`,
      ``,
      `<html><body style="font-family:system-ui,sans-serif;padding:20px;max-width:560px">
        <div style="background:#0E2A50;color:white;padding:16px 20px;border-radius:8px 8px 0 0">
          <div style="font-size:16px;font-weight:600">Lead Abatement Work Plan Generated</div>
          <div style="font-size:12px;color:#93C5FD;margin-top:4px">${wp.workPlanNumber} · ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
        </div>
        <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:0 0 8px 8px;padding:20px">
          <p style="font-size:14px;color:#374151;margin-bottom:16px">
            A Lead Abatement Work Plan has been generated for <strong>${insp.property_address}</strong> and is attached to this email.
          </p>
          <div style="background:white;border:1px solid #E2E8F0;border-radius:6px;padding:12px 16px;margin-bottom:16px">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px">
              <div><span style="color:#64748B">Client:</span> <strong>${insp.client_name || ''}</strong></div>
              <div><span style="color:#64748B">Inspector:</span> <strong>${insp.inspector_name}</strong></div>
              <div><span style="color:#64748B">Property:</span> <strong>${insp.property_address}</strong></div>
              <div><span style="color:#64748B">Level:</span> <strong>${wp.overallRemediationLevel}</strong></div>
              <div><span style="color:#64748B">Total Sq Ft:</span> <strong>${wp.totalAffectedSqft} sf</strong></div>
              <div><span style="color:#64748B">Est. Duration:</span> <strong>${wp.estimatedDuration}</strong></div>
            </div>
          </div>
          <p style="font-size:11px;color:#94A3B8;margin:0">
            NYC Lead Inspections · 208 Meserole Street Brooklyn NY 11206 · (646) 496-7039
          </p>
        </div>
      </body></html>`,
      ``,
      `--${boundary}`,
      `Content-Type: application/pdf`,
      `Content-Transfer-Encoding: base64`,
      `Content-Disposition: attachment; filename="${filename}"`,
      ``,
      pdfBase64,
      `--${boundary}--`
    ].join('\r\n')

    const encoded = Buffer.from(emailLines).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

    const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: encoded })
    })

    return sendRes.ok
  } catch (err) {
    console.error('Work plan email error:', err)
    return false
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { inspectionId } = req.body
  if (!inspectionId) return res.status(400).json({ error: 'inspectionId required' })

  try {
    const { data: insp, error } = await supabase
      .from('inspections')
      .select('*')
      .eq('id', inspectionId)
      .single()

    if (error || !insp) return res.status(404).json({ error: 'Inspection not found' })

    const labData = insp.lab_data || null
    const wp = await callClaudeForWorkPlan(insp.form_data || {}, labData, insp)

    const coverHtml = buildCoverHTML(insp, wp)
    const contentHtml = buildContentHTML(insp, wp)

    await supabase
      .from('inspections')
      .update({ work_plan_data: { ...wp, generatedAt: new Date().toISOString(), coverHtml, contentHtml }, updated_at: new Date().toISOString() })
      .eq('id', inspectionId)

    return res.status(200).json({ success: true, workPlanNumber: wp.workPlanNumber, overallLevel: wp.overallRemediationLevel })

  } catch (err) {
    console.error('Work plan generation error:', err)
    return res.status(500).json({ error: err.message })
  }
}

export const config = {
  api: { responseLimit: '10mb' }
}
