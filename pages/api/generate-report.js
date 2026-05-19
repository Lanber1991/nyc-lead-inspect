import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'
import { createClient } from '@supabase/supabase-js'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import fs from 'fs'
import path from 'path'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

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

const SPECIES_INFO = {
  'stachybotrys': 'A toxigenic species that grows exclusively on chronically wet cellulose materials (drywall paper, wood). Its presence indoors — absent outdoors — is a definitive indicator of an active moisture problem and indoor amplification. Associated with mycotoxin production under certain conditions.',
  'chaetomium': 'A water-damage indicator species that colonizes wet cellulose substrates. Produces a distinctive musty odor and is associated with chronic moisture intrusion. Elevated indoor counts confirm prolonged wetting of building materials.',
  'cladosporium': 'The most commonly detected mold genus both indoors and outdoors. At outdoor-level concentrations it is generally unremarkable; when indoor counts significantly exceed outdoor baseline it indicates an indoor source. Can trigger allergic responses in sensitive individuals.',
  'aspergillus': 'A large genus with species ranging from common environmental molds to opportunistic pathogens. In the context of an IAQ report, elevated Aspergillus counts above outdoor baseline indicate an indoor amplification source and are relevant to occupants with asthma, allergies, or immunosuppression.',
  'penicillium': 'A very common indoor mold associated with water-damaged porous materials. Often reported combined with Aspergillus on Air-O-Cell analysis. Elevated counts above outdoor baseline indicate indoor growth on a wet substrate. Can produce allergens and, in some species, mycotoxins.',
  'asp/pen': 'Aspergillus and Penicillium spores are morphologically similar and reported as a combined category in Air-O-Cell analysis. Both genera are associated with water-damaged materials. Counts significantly above the outdoor control confirm indoor amplification on a wet substrate.',
  'alternaria': 'A common allergenic mold typically associated with outdoor plant material and soil. Elevated indoor counts can indicate high humidity, water-damaged building materials, or plant-related sources indoors. A significant allergen, particularly for individuals with asthma.',
  'fusarium': 'Found in soil and plant debris; can colonize wet building materials. Some species are opportunistic pathogens in immunocompromised individuals. Indoor detection above outdoor baseline warrants investigation of the moisture source.',
  'trichoderma': 'A cellulose-degrading species strongly associated with water-damaged wood and paper-based building materials. Its presence is considered a reliable indicator of a chronic moisture problem in the building envelope.',
  'ulocladium': 'A water-damage indicator species that requires free water to grow. Indoor detection is a reliable marker of a significant moisture event or ongoing water intrusion. It does not grow at ambient humidity alone.',
  'mucor': 'A fast-growing mold associated with high moisture conditions and organic material. Can be an opportunistic pathogen in immunocompromised individuals. Indoor amplification indicates an active wet substrate.',
  'rhizopus': 'A fast-growing mold in the same order as Mucor. Associated with very wet organic substrates. Indoor detection above outdoor levels indicates a significant moisture source.',
  'botrytis': 'Primarily associated with plants and plant debris. Indoor detection can indicate potted plants, stored produce, or water-damaged organic material.',
  'myrothecium': 'A water-damage associated species found on wet paper and wood products. Its presence confirms moisture damage to cellulose-based building materials.',
  'basidiospore': 'Spores from mushroom-producing fungi (wood rot organisms, bracket fungi). Often found outdoors; elevated indoor counts can indicate wood decay in structural elements.',
  'ascospore': 'Spores from sac fungi, including numerous common indoor and outdoor species. Largely outdoor origin; significantly elevated indoor counts warrant further investigation.',
}

function speciesDescription(speciesName) {
  if (!speciesName) return ''
  const norm = speciesName.toLowerCase().replace(/[^a-z/]/g, '')
  for (const [key, desc] of Object.entries(SPECIES_INFO)) {
    if (norm.includes(key.replace(/[^a-z/]/g, ''))) return desc
  }
  return ''
}

function stripMarkdown(text) {
  if (!text) return ''
  return text
    .replace(/^#{1,4}\s+/gm, '')       // ## headings
    .replace(/\*\*([^*]+)\*\*/g, '$1') // **bold**
    .replace(/\*\*/g, '')              // unclosed **
    .replace(/\*([^*]+)\*/g, '$1')     // *italic*
    .replace(/^[-*]\s+/gm, '')         // bullet points
    .replace(/^-{2,}\s*$/gm, '')       // --- horizontal rules
    .trim()
}

function narrativeToHtml(text) {
  if (!text) return ''
  const clean = stripMarkdown(text)
  return clean
    .split(/\n\n+/)
    .filter(p => p.trim())
    .map(p => `<p style="margin:0 0 10px 0">${p.replace(/\n/g, ' ').trim()}</p>`)
    .join('')
}

function sectionSummaryBlock(key, text) {
  const inner = text
    ? `<div class="ai-block" style="margin-top:14px"><div class="ai-label">Inspector Summary</div><div class="ai-text">${narrativeToHtml(text)}</div></div>`
    : ''
  return `<!-- REFINE:${key}:start -->${inner}<!-- REFINE:${key}:end -->`
}

function cleanCaption(text) {
  if (!text) return ''
  if (/error|404|500|failed|undefined/i.test(text)) return ''
  return text
}

function renderPhotoGrid(photos, label) {
  if (!photos?.length) return ''
  const withImg = photos.filter(p => p.b64)
  if (!withImg.length) return ''
  return `
  <div style="margin-bottom:16px">
    <div style="font-size:9pt;font-weight:600;color:#64748B;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px">${label}</div>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">
      ${withImg.map(p => {
        const cap = cleanCaption(p.caption || p.desc)
        return `
        <div style="border:1px solid #E2E8F0;border-radius:6px;overflow:hidden;background:#111;break-inside:avoid">
          <img src="${p.b64}" style="width:100%;height:220px;object-fit:contain;display:block">
          ${cap ? `<div style="padding:6px 10px;font-size:9pt;color:#374151;background:#F8FAFC;overflow-wrap:break-word;word-break:break-word">${cap}</div>` : ''}
        </div>`
      }).join('')}
    </div>
  </div>`
}

function normId(s) {
  return (s || '').replace(/[\s\-_]/g, '').toLowerCase()
}

function matchSamples(formSamples, labSamples) {
  if (!labSamples || !labSamples.length) {
    // No lab data yet — return all form samples with no lab match
    return formSamples.map(s => ({ form: s, lab: null }))
  }
  // With lab data, only return samples that have a matching lab result
  const matched = []
  for (const fs of formSamples) {
    const fId = normId(fs.label)
    if (!fId) continue
    const lab = labSamples.find(ls => {
      const lId = normId(ls.sample_id)
      return lId === fId || lId.includes(fId) || fId.includes(lId)
    })
    if (lab) matched.push({ form: fs, lab })
  }
  // If nothing matched (IDs may differ entirely), fall back to showing all form samples
  return matched.length > 0 ? matched : formSamples.map(s => ({ form: s, lab: null }))
}

function buildReportHTML(insp, labData, summaries = {}, logoB64 = null) {
  const fd = insp.form_data || {}
  const visualOnly = !!(fd.visual_only)
  // Filter out empty area cards (inspector added but didn't fill in)
  const areas = (fd.affectedAreas || []).filter(a => a.room || a.material || a.detail || a.notes)
  const hvacPresent = fd.hvacPresent !== false && !!(
    fd.hvacType || fd.filterCond || fd.ductCond || fd.hvacNotes ||
    fd.filterType || fd.hvacServingArea || fd.moldOnVents || fd.hvacDuringSampling ||
    photos.hvac?.some(p => p.b64)
  )
  const rawAirSamples = (fd.airSamples || []).filter(s => s.label || s.location || s.type)
  const recs = fd.recommendations?.items || []
  const risk = fd.riskLevel || '—'
  const photos = fd.photos || {}

  const pairedSamples = matchSamples(rawAirSamples, labData?.samples)
  const airSamples = pairedSamples.map(p => p.form)

  const riskColor = risk.includes('High') ? '#991B1B' : risk.includes('Moderate') ? '#92400E' : risk.includes('Low') ? '#166534' : '#374151'
  const riskBg = risk.includes('High') ? '#FEE2E2' : risk.includes('Moderate') ? '#FEF3C7' : risk.includes('Low') ? '#DCFCE7' : '#F3F4F6'

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 11pt; color: #1a1a1a; line-height: 1.5; }
  .cover { background: #0E2A50; min-height: 100vh; padding: 60px 50px; color: white; page-break-after: always; display: flex; flex-direction: column; }
  .cover-logo { font-size: 11pt; color: #93C5FD; margin-bottom: 4px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; }
  .cover-sub { font-size: 9pt; color: #6EA8D8; }
  .cover-title { font-size: 32pt; font-weight: 300; margin-bottom: 8px; margin-top: 120px; }
  .cover-title strong { font-weight: 700; }
  .cover-divider { width: 80px; height: 3px; background: #185FA5; margin: 20px 0 40px; }
  .cover-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 30px; margin-top: auto; }
  .cover-field-label { font-size: 8pt; color: #93C5FD; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .cover-field-value { font-size: 13pt; font-weight: 500; }
  .cover-field-sub { font-size: 9pt; color: #BAD4F5; margin-top: 2px; }
  .page { padding: 30px 40px; }
  .page + .page { page-break-before: always; }
  .page-header { background: #0E2A50; color: white; padding: 10px 16px; border-radius: 4px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; font-size: 9pt; break-after: avoid; }
  .sec-head { background: #0E2A50; color: white; padding: 14px 16px; border-radius: 4px; margin-bottom: 16px; break-inside: avoid; break-after: avoid; }
  .sec-head-title { font-size: 11pt; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; }
  .sec-head-sub { font-size: 9pt; color: #93C5FD; margin-top: 3px; }
  .field-row { display: flex; align-items: stretch; border-bottom: 1px solid #F1F5F9; }
  .field-row:last-child { border-bottom: none; }
  .field-label { background: #F8FAFC; padding: 7px 12px; font-size: 9pt; font-weight: 600; color: #64748B; width: 38%; flex-shrink: 0; overflow-wrap: break-word; word-break: break-word; }
  .field-value { padding: 7px 12px; font-size: 10pt; color: #0F172A; flex: 1; overflow-wrap: break-word; word-break: break-word; }
  .fields-table { border: 1px solid #E2E8F0; border-radius: 6px; overflow: visible; margin-bottom: 14px; }
  .ai-block { background: #EFF6FF; border-left: 3px solid #185FA5; border-radius: 0 6px 6px 0; padding: 12px 16px; margin: 14px 0; overflow-wrap: break-word; word-break: break-word; }
  .ai-label { font-size: 8pt; font-weight: 700; color: #185FA5; letter-spacing: 0.5px; margin-bottom: 6px; text-transform: uppercase; }
  .ai-text { font-size: 10pt; color: #1E3A5F; font-style: italic; line-height: 1.6; overflow-wrap: break-word; word-break: break-word; }
  .ai-text p:last-child { margin-bottom: 0; }
  .area-card { border: 1px solid #E2E8F0; border-radius: 6px; padding: 12px 16px; margin-bottom: 12px; }
  .area-title { font-size: 11pt; font-weight: 600; margin-bottom: 8px; color: #0F172A; overflow-wrap: break-word; word-break: break-word; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 10px; font-size: 9pt; font-weight: 600; }
  .sample-row { display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px solid #F1F5F9; font-size: 10pt; }
  .rec-item { border-left: 3px solid #185FA5; padding: 8px 12px; margin-bottom: 8px; background: #F8FAFC; border-radius: 0 4px 4px 0; }
  .rec-pri { font-size: 8pt; font-weight: 700; color: #185FA5; text-transform: uppercase; margin-bottom: 3px; }
  .footer { display:none; }
  .risk-badge { display: inline-block; padding: 4px 16px; border-radius: 20px; font-size: 11pt; font-weight: 600; background: ${riskBg}; color: ${riskColor}; }
  .exec-stat { background: #EFF6FF; border-radius: 6px; padding: 12px 16px; text-align: center; }
  .exec-stat-num { font-size: 24pt; font-weight: 700; color: #185FA5; }
  .exec-stat-label { font-size: 8pt; color: #64748B; margin-top: 2px; }
  .exec-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }
  @page { margin: 24px 0 48px 0; }
  @page :first { margin: 0 !important; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  body { padding-bottom: 36px; }
  .cover-field-value { overflow-wrap: break-word; word-break: break-word; }
  .area-card { break-inside: avoid; }
  .fields-table { break-inside: avoid; }
</style>
</head>
<body>

<!-- COVER PAGE -->
<div class="cover">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:auto">
    <div>
      <div class="cover-logo">NYC Lead Inspections</div>
      <div class="cover-sub">Residential Building Services</div>
    </div>
    ${logoB64 ? `<div style="background:white;border-radius:10px;padding:12px 16px;display:inline-flex;align-items:center;justify-content:center"><img src="${logoB64}" style="height:110px;width:auto;object-fit:contain;display:block"></div>` : ''}
  </div>
  <div class="cover-title">${visualOnly ? 'Visual Mold' : 'IAQ / Mold'}<br><strong>Assessment Report</strong></div>
  <div class="cover-divider"></div>
  <div class="cover-grid">
    <div>
      ${photos.exterior ? `<img src="${photos.exterior}" style="width:100%;height:160px;object-fit:cover;border-radius:8px;border:1px solid rgba(255,255,255,0.15);margin-bottom:14px;display:block">` : ''}
      <div class="cover-field-label">Property</div>
      <div class="cover-field-value">${fd.propAddr || insp.property_address}</div>
      <div class="cover-field-sub">${insp.property_city} ${insp.property_state_zip}</div>
    </div>
    <div>
      <div class="cover-field-label">Date of Inspection</div>
      <div class="cover-field-value">${insp.inspection_date} ${fd.inspTime || ''}</div>
      <div style="margin-top:16px">
        <div class="cover-field-label">Report Prepared By</div>
        <div class="cover-field-value">${insp.inspector_name}</div>
        <div class="cover-field-sub">Mold Assessor — NYS DOL · NYC Lead Inspections</div>
      </div>
      <div style="margin-top:16px">
        <div class="cover-field-label">Report Prepared For</div>
        <div class="cover-field-value">${insp.client_name || '—'}</div>
      </div>
    </div>
  </div>
  <div style="margin-top:20px;font-size:9pt;color:#4A6FA5">Report #: ${insp.report_number} · COC #: ${fd.cocNumber || '—'}</div>
</div>

<!-- EXECUTIVE SUMMARY -->
<div class="page">
  <div class="page-header">
    <span>NYC Lead Inspections · IAQ Report</span>
    <span>${insp.report_number}</span>
  </div>
  <div class="sec-head">
    <div class="sec-head-title">Executive Summary</div>
  </div>
  <div style="margin-bottom:16px">
    <div class="risk-badge">Overall Risk: ${risk}</div>
  </div>
  <div class="exec-grid">
    <div class="exec-stat"><div class="exec-stat-num">${areas.length}</div><div class="exec-stat-label">Affected Areas</div></div>
    ${visualOnly
      ? `<div class="exec-stat"><div class="exec-stat-num" style="font-size:14pt;padding-top:4px">Visual</div><div class="exec-stat-label">Inspection Type</div></div>
         <div class="exec-stat"><div class="exec-stat-num">—</div><div class="exec-stat-label">Air Samples</div></div>`
      : `<div class="exec-stat"><div class="exec-stat-num">${pairedSamples.length}</div><div class="exec-stat-label">Air Samples</div></div>
         <div class="exec-stat"><div class="exec-stat-num">${pairedSamples.filter(p => p.lab).length}</div><div class="exec-stat-label">Lab Results</div></div>`}
    <div class="exec-stat"><div class="exec-stat-num">${recs.length}</div><div class="exec-stat-label">Recommendations</div></div>
  </div>
  <div class="fields-table">
    <div class="field-row"><div class="field-label">Property</div><div class="field-value">${fd.propAddr || insp.property_address}, ${insp.property_city}</div></div>
    <div class="field-row"><div class="field-label">Client</div><div class="field-value">${insp.client_name || '—'}</div></div>
    <div class="field-row"><div class="field-label">Inspector</div><div class="field-value">${insp.inspector_name}</div></div>
    <div class="field-row"><div class="field-label">Date & Time</div><div class="field-value">${insp.inspection_date} ${fd.inspTime || ''}</div></div>
    <div class="field-row"><div class="field-label">COC #</div><div class="field-value">${fd.cocNumber || '—'}</div></div>
    <div class="field-row"><div class="field-label">Purpose</div><div class="field-value">${insp.purpose || '—'}</div></div>
  </div>
  ${recs.length > 0 ? `
  <div style="font-size:9pt;font-weight:600;color:#64748B;text-transform:uppercase;letter-spacing:0.5px;margin:16px 0 8px">Key Recommendations</div>
  ${recs.slice(0,3).map(r => `
    <div class="rec-item">
      <div class="rec-pri">${r.priority || ''}</div>
      <div style="font-size:10pt">${r.text || ''}</div>
    </div>`).join('')}
  ` : ''}
  </div>

<!-- SITE INFO -->
<div class="page">
  <div class="page-header"><span>NYC Lead Inspections · IAQ Report</span><span>${insp.report_number}</span></div>
  <div class="sec-head">
    <div class="sec-head-title">1. Site & Inspector Information</div>
    <div class="sec-head-sub">${fd.propAddr || ''} · ${insp.inspection_date}</div>
  </div>
  <div class="fields-table">
    <div class="field-row"><div class="field-label">Inspector</div><div class="field-value">${insp.inspector_name}</div></div>
    <div class="field-row"><div class="field-label">Certification #</div><div class="field-value">${fd.inspCert || '—'}</div></div>
    <div class="field-row"><div class="field-label">Report #</div><div class="field-value">${insp.report_number}</div></div>
    <div class="field-row"><div class="field-label">COC #</div><div class="field-value">${fd.cocNumber || '—'}</div></div>
    <div class="field-row"><div class="field-label">Date & Time</div><div class="field-value">${insp.inspection_date} ${fd.inspTime || ''}</div></div>
    <div class="field-row"><div class="field-label">Property Address</div><div class="field-value">${fd.propAddr || ''} ${fd.propUnit && fd.propUnit !== '—' ? 'Unit ' + fd.propUnit : ''}, ${insp.property_city} ${insp.property_state_zip}</div></div>
    <div class="field-row"><div class="field-label">Property Type</div><div class="field-value">${fd.propType || '—'}</div></div>
    <div class="field-row"><div class="field-label">Client</div><div class="field-value">${insp.client_name || '—'}</div></div>
    <div class="field-row"><div class="field-label">Purpose</div><div class="field-value">${insp.purpose || '—'}</div></div>
    <div class="field-row"><div class="field-label">Outdoor Temp / RH</div><div class="field-value">${fd.outdoorTemp || '—'}°F / ${fd.outdoorRH || '—'}%</div></div>
    <div class="field-row"><div class="field-label">Weather</div><div class="field-value">${fd.weather || '—'}</div></div>
    <div class="field-row"><div class="field-label">Occupancy</div><div class="field-value">${fd.occupancyStatus || '—'}</div></div>
  </div>
  ${sectionSummaryBlock('visual', summaries.visual)}
  </div>

<!-- AFFECTED AREAS -->
<div class="page">
  <div class="page-header"><span>NYC Lead Inspections · IAQ Report</span><span>${insp.report_number}</span></div>
  <div class="sec-head">
    <div class="sec-head-title">2. Affected Areas — Mold, Moisture & Thermal</div>
    <div class="sec-head-sub">${areas.length} area(s) documented · Overall risk: ${risk}</div>
  </div>
  ${areas.map((a, i) => `
    <div class="area-card">
      <div class="area-title">Area ${i+1}: ${a.room || ''}${a.detail ? ' — ' + a.detail : ''}
        <span class="badge" style="margin-left:8px;background:${a.severity?.includes('High') ? '#FEE2E2' : a.severity?.includes('Moderate') ? '#FEF3C7' : '#F3F4F6'};color:${a.severity?.includes('High') ? '#991B1B' : a.severity?.includes('Moderate') ? '#92400E' : '#374151'}">${a.severity || '—'}</span>
      </div>
      <div class="fields-table">
        <div class="field-row"><div class="field-label">Material</div><div class="field-value">${a.material || '—'}</div></div>
        <div class="field-row"><div class="field-label">Estimated Area</div><div class="field-value">${a.area || '—'} sq ft</div></div>
        <div class="field-row"><div class="field-label">Moisture Source</div><div class="field-value">${a.source || '—'}</div></div>
        <div class="field-row"><div class="field-label">Substrate</div><div class="field-value">${a.substrate || '—'}</div></div>
        <div class="field-row"><div class="field-label">Accessibility</div><div class="field-value">${a.accessibility || '—'}</div></div>
        <div class="field-row"><div class="field-label">Samples</div><div class="field-value">${Array.isArray(a.sample) ? a.sample.join(', ') : (a.sample || '—')}</div></div>
      </div>
      ${a.notes ? `<div style="font-size:10pt;color:#374151;margin-top:8px;padding:8px;background:#F8FAFC;border-radius:4px">${a.notes}</div>` : ''}
      ${renderPhotoGrid(a.moldPhotos, 'Mold Photos')}
      ${renderPhotoGrid(a.thermalPhotos, 'Thermal & Moisture Photos')}
    </div>`).join('')}
  ${sectionSummaryBlock('areas', summaries.areas)}
  </div>

<!-- SAMPLES -->
<div class="page">
  <div class="page-header"><span>NYC Lead Inspections · IAQ Report</span><span>${insp.report_number}</span></div>
  <div class="sec-head">
    <div class="sec-head-title">3. ${visualOnly ? 'Inspection Method' : 'Air Samples & Laboratory Results'}</div>
    <div class="sec-head-sub">${visualOnly ? 'Visual inspection — no air sampling conducted' : `COC #${fd.cocNumber || '—'} · ${pairedSamples.length} sample(s)`}</div>
  </div>
  ${visualOnly ? `
  <div style="border:2px solid #185FA5;border-radius:8px;padding:24px 28px;margin:16px 0;background:#EFF6FF">
    <div style="font-size:13pt;font-weight:600;color:#0E2A50;margin-bottom:10px">👁 Visual Inspection Only</div>
    <p style="font-size:10pt;color:#1E3A5F;line-height:1.65;margin-bottom:10px">
      This inspection was conducted as a <strong>visual-only assessment</strong>. No air sampling or laboratory analysis was performed.
      Findings are based entirely on direct observation of the property, including visual identification of mold growth,
      moisture meter readings, thermal imaging, and inspector notes.
    </p>
    <p style="font-size:10pt;color:#1E3A5F;line-height:1.65;margin:0">
      If air sampling and laboratory analysis are required (e.g., for litigation, post-remediation clearance, or regulatory
      compliance), a follow-up sampling inspection can be scheduled.
    </p>
  </div>
  ` : `
  <div class="fields-table" style="margin-bottom:16px">
    <div class="field-row"><div class="field-label">Sampling Device</div><div class="field-value">Air-O-Cell cassette</div></div>
    <div class="field-row"><div class="field-label">Pump Model</div><div class="field-value">Environmental Express IAQ 15 Connect</div></div>
    <div class="field-row"><div class="field-label">Flow Rate</div><div class="field-value">${fd.flowRate || '15'} L/min</div></div>
    <div class="field-row"><div class="field-label">Laboratory</div><div class="field-value">${fd.labName || 'EMSL Analytical'}</div></div>
  </div>
  ${pairedSamples.map(({ form: s, lab }, i) => `
    <div class="area-card">
      <div class="area-title">
        Sample #${i+1}${s.label ? ' [' + s.label + ']' : ''}${s.outdoor_control || lab?.outdoor_control ? ' — Outdoor Control' : (s.type ? ' — ' + s.type : '')}
      </div>
      <div class="fields-table">
        <div class="field-row"><div class="field-label">Location</div><div class="field-value">${s.location || lab?.location || '—'}</div></div>
        <div class="field-row"><div class="field-label">Duration / Volume</div><div class="field-value">${s.duration || '—'} min / ${s.volume || '—'} L</div></div>
        ${lab ? `<div class="field-row"><div class="field-label">Lab Sample ID</div><div class="field-value">${lab.sample_id}</div></div>` : ''}
      </div>
      ${lab ? `
        <div style="margin-top:10px">
          <div style="font-size:9pt;font-weight:600;color:#64748B;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Lab Results</div>
          ${lab.results?.length ? lab.results.map(r => `
            <div class="sample-row">
              <span>${r.species}</span>
              <span style="color:#374151;font-weight:500">${r.count} ${r.unit || ''}${r.notes ? ' — ' + r.notes : ''}</span>
            </div>`).join('') : '<div style="color:#94A3B8;font-size:10pt;padding:4px 0">No organisms detected above reportable limits</div>'}
          ${lab.raw_summary ? `<div style="font-size:9pt;color:#64748B;margin-top:6px;font-style:italic">${lab.raw_summary}</div>` : ''}
        </div>` : `<div style="font-size:9pt;color:#94A3B8;margin-top:8px;font-style:italic">Lab results pending</div>`}
    </div>`).join('')}
  ${(() => {
    const seen = new Map()
    for (const { lab, form: s } of pairedSamples) {
      if (!lab?.results || s.outdoor_control || lab.outdoor_control) continue
      for (const r of lab.results) {
        const nd = /^(nd|not detected|none|0)$/i.test(String(r.count || '').trim())
        if (nd) continue
        const key = (r.species || '').trim().toLowerCase()
        if (!seen.has(key)) seen.set(key, r.species)
      }
    }
    if (!seen.size) return ''
    const rows = [...seen.values()].map(name => {
      const desc = speciesDescription(name)
      if (!desc) return ''
      return `<div style="padding:10px 0;border-bottom:1px solid #E2E8F0">
        <div style="font-size:10pt;font-weight:600;color:#0F172A;margin-bottom:3px">${name}</div>
        <div style="font-size:9pt;color:#475569;line-height:1.55">${desc}</div>
      </div>`
    }).filter(Boolean).join('')
    if (!rows) return ''
    return `<div style="border:1px solid #E2E8F0;border-radius:6px;padding:12px 16px;margin:14px 0">
      <div style="font-size:9pt;font-weight:700;color:#185FA5;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Species Identified</div>
      ${rows}
    </div>`
  })()}
  ${sectionSummaryBlock('samples', summaries.samples)}
  `}
  </div>

<!-- HVAC -->
${hvacPresent ? `
<div class="page">
  <div class="page-header"><span>NYC Lead Inspections · IAQ Report</span><span>${insp.report_number}</span></div>
  <div class="sec-head">
    <div class="sec-head-title">4. HVAC Inspection</div>
    <div class="sec-head-sub">${fd.hvacType || 'System type not specified'} · Filter: ${fd.filterCond || 'Not assessed'}</div>
  </div>
  <div class="fields-table">
    <div class="field-row"><div class="field-label">HVAC Type</div><div class="field-value">${fd.hvacType || '—'}</div></div>
    <div class="field-row"><div class="field-label">Filter Condition</div><div class="field-value">${fd.filterCond || '—'}</div></div>
    <div class="field-row"><div class="field-label">Filter Type / MERV</div><div class="field-value">${fd.filterType || '—'}</div></div>
    <div class="field-row"><div class="field-label">Duct Condition</div><div class="field-value">${fd.ductCond || '—'}</div></div>
    <div class="field-row"><div class="field-label">Serving Affected Area</div><div class="field-value">${fd.hvacServingArea || '—'}</div></div>
    <div class="field-row"><div class="field-label">Mold on Vents</div><div class="field-value">${fd.moldOnVents || '—'}</div></div>
    <div class="field-row"><div class="field-label">HVAC During Sampling</div><div class="field-value">${fd.hvacDuringSampling || '—'}</div></div>
  </div>
  ${fd.hvacNotes ? `<div class="ai-block"><div class="ai-label">HVAC Notes</div><div class="ai-text">${fd.hvacNotes}</div></div>` : ''}
  ${renderPhotoGrid(photos.hvac, 'HVAC Photos')}
  ${sectionSummaryBlock('hvac', summaries.hvac)}
  </div>` : ''}

<!-- SITE & INSPECTION PHOTOS -->
${photos.visual?.some(p => p.b64) ? `
<div class="page">
  <div class="page-header"><span>NYC Lead Inspections · IAQ Report</span><span>${insp.report_number}</span></div>
  <div class="sec-head">
    <div class="sec-head-title">Site & Inspection Photos</div>
    <div class="sec-head-sub">${insp.property_address}</div>
  </div>
  ${renderPhotoGrid(photos.visual, 'Visual Inspection Photos')}
  </div>` : ''}

<!-- RECOMMENDATIONS -->
<div class="page">
  <div class="page-header"><span>NYC Lead Inspections · IAQ Report</span><span>${insp.report_number}</span></div>
  <div class="sec-head">
    <div class="sec-head-title">5. Recommendations & Conclusions</div>
    <div class="sec-head-sub">Risk Level: ${risk}</div>
  </div>
  <div style="margin-bottom:16px"><span class="risk-badge">Overall Risk: ${risk}</span></div>
  ${recs.map(r => `
    <div class="rec-item">
      <div class="rec-pri">${r.priority || ''} · ${r.category || ''}</div>
      <div style="font-size:10pt">${r.text || ''}</div>
    </div>`).join('')}
  ${fd.conclusions ? `<div class="ai-block" style="margin-top:16px"><div class="ai-label">Inspector Conclusions</div><div class="ai-text">${fd.conclusions}</div></div>` : ''}
  ${sectionSummaryBlock('recommendations', summaries.recommendations)}
  </div>

<!-- INTEGRATED ASSESSMENT -->
${summaries.integrated ? `
<div class="page">
  <div class="page-header"><span>NYC Lead Inspections · IAQ Report</span><span>${insp.report_number}</span></div>
  <div class="sec-head">
    <div class="sec-head-title">Integrated Assessment</div>
    <div class="sec-head-sub">Professional synthesis — ${insp.inspector_name} · ${insp.inspection_date}</div>
  </div>
  <div class="ai-block" style="margin-top:0">
    <div class="ai-label">Overall Assessment</div>
    <div class="ai-text" style="font-style:normal;line-height:1.7">${narrativeToHtml(summaries.integrated)}</div>
  </div>
  </div>` : ''}

<!-- LAB INTERPRETATION -->
${labData?.narrative ? `
<div class="page">
  <div class="page-header"><span>NYC Lead Inspections · IAQ Report</span><span>${insp.report_number}</span></div>
  <div class="sec-head">
    <div class="sec-head-title">6. Laboratory Interpretation</div>
    <div class="sec-head-sub">COC #${fd.cocNumber || labData.cocNumber || '—'} · Full laboratory report attached as appendix</div>
  </div>
  <div class="ai-block">
    <div class="ai-label">Analysis & Interpretation</div>
    <div class="ai-text" style="font-style:normal;line-height:1.7">${narrativeToHtml(labData.narrative)}</div>
  </div>
  </div>` : ''}

<div class="footer">NYC Lead Inspections · 208 Meserole Street Brooklyn NY 11206 · (646) 496-7039 · info@mindfulsolutionsny.com · www.mindfulsolutionsny.com</div>
</body>
</html>`
}

function toImageBlock(dataUrl) {
  if (!dataUrl) return null
  const match = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/)
  if (!match) return null
  return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } }
}

async function callClaude(model, systemPrompt, contentBlocks, maxTokens = 600) {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: contentBlocks }]
      })
    })
    const data = await res.json()
    return data.content?.[0]?.text?.trim() || ''
  } catch (e) {
    console.error('Claude summary error:', e.message)
    return ''
  }
}

async function generateSectionSummaries(insp, labData) {
  const fd = insp.form_data || {}
  const visualOnly = !!(fd.visual_only)
  const areas = fd.affectedAreas || []
  const airSamples = (fd.airSamples || []).filter(s => s.label || s.location || s.type)
  const photos = fd.photos || {}
  const hvacPresent = fd.hvacPresent !== false && !!(
    fd.hvacType || fd.filterCond || fd.ductCond || fd.hvacNotes ||
    fd.filterType || fd.hvacServingArea || fd.moldOnVents || fd.hvacDuringSampling ||
    photos.hvac?.some(p => p.b64)
  )
  if (!process.env.ANTHROPIC_API_KEY) return {}

  const SONNET = 'claude-sonnet-4-6'
  const HAIKU  = 'claude-haiku-4-5-20251001'

  const SYSTEM = `You are writing a professional Lead Paint Inspection & Risk Assessment report for a client — a building owner or property manager. Write in past tense, third person. Be specific about locations, readings, and what they mean in plain language. Do not invent data not present in the inputs. When analyzing photos, describe exactly what is visible and what it indicates about paint condition, deterioration, or lead hazard risk.

REGULATORY FRAMEWORK: This report is governed by the following standards — reference them where relevant but do not over-cite:
- NYC Local Law 1 of 2004 (as amended): the primary NYC law governing lead paint hazards in pre-1960 residential dwellings (and pre-1978 if a child under 6 resides there). Requires landlords to identify and remediate lead paint hazards.
- HUD Guidelines for the Evaluation and Control of Lead-Based Paint Hazards in Housing (2012): the federal technical reference for inspection methodology, risk assessment, hazard thresholds, and abatement work practices.
- EPA RRP Rule (40 CFR Part 745): governs renovation, repair, and painting activities that disturb lead-based paint in pre-1978 housing. Requires EPA-certified contractors and work practice standards.
- NYS Public Health Law Article 13-L and 10 NYCRR Part 67: NYS licensing requirements for lead inspectors and risk assessors.
You may use industry-standard technical guidance to fill any technical gaps not covered by the above, but do not reference or cite any specific standards by name beyond those listed.

DUST WIPE CLEARANCE THRESHOLDS (EPA/NYC): Floors — 10 μg/ft²; Interior window sills — 100 μg/ft²; Window troughs — 100 μg/ft². Results above these thresholds constitute a lead dust hazard and require remediation.

CRITICAL FORMATTING RULE: Your entire response must be a single paragraph of exactly 3 to 5 sentences. Do not use headers, subheadings, bullet points, numbered lists, or multiple paragraphs under any circumstances. Synthesize all findings into one concise paragraph only. Stop after 5 sentences.`

  // Helper: append photos from an array to a content block list
  function addPhotos(blocks, photoArray, contextLabel) {
    if (!photoArray?.length) return
    for (const p of photoArray) {
      const img = toImageBlock(p.b64)
      if (!img) continue
      blocks.push({ type: 'text', text: `${contextLabel}${p.caption || p.desc ? ' — ' + (p.caption || p.desc) : ''}:` })
      blocks.push(img)
    }
  }

  // 1. VISUAL INSPECTION — Sonnet (may have exterior + visual photos)
  const visualBlocks = [{
    type: 'text',
    text: `Write the Visual Inspection summary.
Property: ${fd.propAddr || insp.property_address}, ${insp.property_city} | Type: ${fd.propType || '—'} | Year: ${fd.yearBuilt || '—'} | Sqft: ${fd.sqft || '—'}
Occupancy: ${fd.occupancyStatus || '—'} | Vulnerable occupants: ${fd.vulnerableOccupants || '—'}
Prior remediation: ${fd.priorRemediation || '—'} | Plumbing issues: ${fd.plumbingHistory || '—'}
Moisture present for: ${fd.moistureDuration || '—'}
Odors: ${fd.visualInspection?.odors || '—'}
Health complaints: ${Array.isArray(fd.visualInspection?.healthComplaints) ? fd.visualInspection.healthComplaints.join(', ') : (fd.visualInspection?.healthComplaints || '—')}
Inspector observations: ${fd.generalObs || '—'}
Outdoor conditions: ${fd.weather || '—'}, ${fd.outdoorTemp || '—'}°F, ${fd.outdoorRH || '—'}% RH`
  }]
  const extImg = toImageBlock(photos.exterior)
  if (extImg) { visualBlocks.push({ type: 'text', text: 'Exterior photo of the property:' }); visualBlocks.push(extImg) }
  addPhotos(visualBlocks, photos.visual, 'Visual inspection photo')

  // 2. AFFECTED AREAS — Sonnet (mold photos + Flir thermal/moisture images)
  const areasSummaryText = areas.length
    ? areas.map((a, i) =>
        `Area ${i+1}: ${a.room || ''}${a.detail ? ' — ' + a.detail : ''}
  Severity: ${a.severity || '—'} | Area: ${a.area || '—'} sq ft | Material: ${a.material || '—'} | Source: ${a.source || '—'}
  Substrate: ${a.substrate || '—'}
  Notes: ${a.notes || '—'}`
      ).join('\n\n')
    : 'No affected areas documented.'

  const areasBlocks = [{
    type: 'text',
    text: `Write the Affected Areas summary covering mold findings, moisture readings, and thermal/Flir observations. Moisture meter readings and temperature/RH/dew point values are NOT entered manually — you must read them directly from the photos provided. For each Flir or moisture meter image: read the exact number displayed on the meter or shown in the image, state what it is (moisture content %, temperature, RH, dew point), and explain what it indicates about the moisture condition. Interpret Flir thermal color gradients — blues/purples indicate evaporative cooling or moisture, reds/yellows indicate heat or moisture accumulation.
Moisture has been present for: ${fd.moistureDuration || '—'}
${areasSummaryText}`
  }]
  for (const a of areas) {
    addPhotos(areasBlocks, a.moldPhotos,    `Mold photo — ${a.room || ''}${a.detail ? ' ' + a.detail : ''}`)
    addPhotos(areasBlocks, a.thermalPhotos, `Flir thermal/moisture image — ${a.room || ''}${a.detail ? ' ' + a.detail : ''} (interpret color gradient and any meter readings visible)`)
  }

  // 3. SAMPLES — Haiku (text only)
  const paired = matchSamples(airSamples, labData?.samples)
  const samplesText = paired.length
    ? paired.map(({ form: s, lab }, i) =>
        `Sample ${i+1} [${s.label || ''}]: ${s.type || '—'} at ${s.location || '—'} | ${s.duration || '—'} min / ${s.volume || '—'} L
  ${lab ? `Results: ${lab.raw_summary || lab.results?.map(r => `${r.species} ${r.count} ${r.unit || ''}`).join(', ') || 'No organisms above limits'}` : 'Pending'}`
      ).join('\n')
    : 'No air samples collected.'

  const samplesBlocks = [{
    type: 'text',
    text: `Write the Air Sampling summary explaining what was collected, where, and what the results indicate for indoor air quality.
${samplesText}
Lab interpretation: ${labData?.narrative || 'Not yet available'}`
  }]

  // 4. HVAC — Sonnet if photos exist, Haiku if not
  const hvacBlocks = [{
    type: 'text',
    text: `Write the HVAC Inspection summary.
System type: ${fd.hvacType || '—'} | Filter condition: ${fd.filterCond || '—'} | Filter type: ${fd.filterType || '—'}
Duct condition: ${fd.ductCond || '—'} | Serving affected area: ${fd.hvacServingArea || '—'}
Mold on vents: ${fd.moldOnVents || '—'} | HVAC running during sampling: ${fd.hvacDuringSampling || '—'}
Notes: ${fd.hvacNotes || '—'}`
  }]
  const hasHvacPhotos = photos.hvac?.some(p => p.b64)
  addPhotos(hvacBlocks, photos.hvac, 'HVAC photo')

  // 5. RECOMMENDATIONS — Haiku (text only)
  const recItems = fd.recommendations?.items || []
  const recsText = recItems.length
    ? recItems.map(r => `${r.priority || ''} | ${r.category || ''}: ${r.text || ''}`).join('\n')
    : 'No specific recommendations entered.'

  const recBlocks = [{
    type: 'text',
    text: `Write the Recommendations & Conclusions summary for the client explaining what needs to be done and why.
Overall risk: ${fd.riskLevel || '—'}
${recsText}
Inspector conclusions: ${fd.conclusions || '—'}`
  }]

  const [visual, areas_s, samples, hvac, recommendations] = await Promise.all([
    callClaude(SONNET, SYSTEM, visualBlocks, 1500),
    callClaude(SONNET, SYSTEM, areasBlocks, 1500),
    visualOnly ? Promise.resolve('') : callClaude(HAIKU, SYSTEM, samplesBlocks, 900),
    hvacPresent ? callClaude(hasHvacPhotos ? SONNET : HAIKU, SYSTEM, hvacBlocks, 900) : Promise.resolve(''),
    (recItems.length > 0 || fd.conclusions) ? callClaude(HAIKU, SYSTEM, recBlocks, 900) : Promise.resolve(''),
  ])

  // 6. INTEGRATED ASSESSMENT — Sonnet, synthesizes all sections into one paragraph
  const integratedBlocks = [{
    type: 'text',
    text: `You are writing the Integrated Assessment closing paragraph for a professional Lead Paint Inspection report. This paragraph appears at the end of the report, after the reader has reviewed all the findings. Synthesize the following section summaries into one authoritative, cohesive paragraph (5–7 sentences) that answers the question: "What does all of this mean together?" Connect the visual findings to the moisture readings, the air quality data to the affected areas, and the HVAC condition to the overall risk. Conclude with the professional recommendation. Plain prose only — no markdown, no bullet points, no headers.

Property: ${fd.propAddr || insp.property_address}, ${insp.property_city} | Inspector: ${insp.inspector_name} | Date: ${insp.inspection_date}
Overall risk: ${fd.riskLevel || '—'} | Affected areas: ${areas.length} | Air samples: ${airSamples.length}

Visual Inspection: ${visual || 'Not available'}

Affected Areas & Moisture: ${areas_s || 'Not available'}

Air Sampling: ${samples || 'Not available'}
${hvacPresent && hvac ? `\nHVAC: ${hvac}\n` : ''}
Recommendations: ${recommendations || 'Not available'}

Lab Interpretation: ${labData?.narrative ? labData.narrative.slice(0, 600) : 'Lab results not yet available'}`
  }]

  const integrated = await callClaude(SONNET, SYSTEM, integratedBlocks, 900)

  return { visual, areas: areas_s, samples, hvac, recommendations, integrated }
}

async function sendReportEmail(pdfBuffer, insp) {
  try {
    const accessToken = await getGmailAccessToken()
    if (!accessToken) return false

    const fd = insp.form_data || {}
    const visualOnly = !!(fd.visual_only)
    const inspectorEmail = fd.inspEmail || ''
    const pdfBase64 = Buffer.from(pdfBuffer).toString('base64')
    const filename = `IAQ_Report_${insp.report_number}_${insp.property_address.replace(/[^a-z0-9]/gi,'_').slice(0,30)}.pdf`

    // Build To field — always reports@, add inspector email if available
    const toAddresses = ['reports@mindfulsolutionsny.com']
    if (inspectorEmail && inspectorEmail !== '—' && inspectorEmail.includes('@')) {
      toAddresses.push(inspectorEmail)
    }
    const toLine = toAddresses.join(', ')

    // Inspector-specific note in email body
    const inspectorNote = inspectorEmail && inspectorEmail !== '—'
      ? `<div style="background:#FEF3C7;border:1px solid #FCD34D;border-radius:6px;padding:12px 16px;margin:16px 0;font-size:13px;color:#92400E">
          <strong>📋 Inspector Review Requested</strong><br>
          ${insp.inspector_name} — please review the attached report for accuracy before it is delivered to the client. If any corrections are needed, contact the office at info@mindfulsolutionsny.com.
        </div>`
      : ''

    const boundary = 'boundary_' + Date.now()
    const emailLines = [
      `From: reports@mindfulsolutionsny.com`,
      `To: ${toLine}`,
      `Subject: ✓ Report Ready for Review: ${insp.report_number} — ${insp.property_address}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      ``,
      `--${boundary}`,
      `Content-Type: text/html; charset=utf-8`,
      ``,
      `<html><body style="font-family:system-ui,sans-serif;padding:20px;max-width:560px">
        <div style="background:#0E2A50;color:white;padding:16px 20px;border-radius:8px 8px 0 0">
          <div style="font-size:16px;font-weight:600">IAQ Report Generated</div>
          <div style="font-size:12px;color:#93C5FD;margin-top:4px">${insp.report_number} · ${new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</div>
        </div>
        <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:0 0 8px 8px;padding:20px">
          <p style="font-size:14px;color:#374151;margin-bottom:16px">
            ${visualOnly
              ? `A <strong>visual inspection report</strong> has been generated for <strong>${insp.property_address}</strong>.
                 No air sampling was conducted — findings are based on direct visual observation, moisture readings, and thermal imaging.`
              : `Lab results were received and matched for <strong>${insp.property_address}</strong>.
                 The full Lead Paint Inspection Report has been generated automatically and is attached to this email.
                 The report includes the COC, lab results, and assessor license as appendices.`}
          </p>
          ${inspectorNote}
          <div style="background:white;border:1px solid #E2E8F0;border-radius:6px;padding:12px 16px;margin-bottom:16px">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px">
              <div><span style="color:#64748B">Client:</span> <strong>${insp.client_name || '—'}</strong></div>
              <div><span style="color:#64748B">Inspector:</span> <strong>${insp.inspector_name}</strong></div>
              <div><span style="color:#64748B">Property:</span> <strong>${insp.property_address}</strong></div>
              <div><span style="color:#64748B">Date:</span> <strong>${insp.inspection_date}</strong></div>
              <div><span style="color:#64748B">COC #:</span> <strong>${fd.cocNumber || '—'}</strong></div>
              <div><span style="color:#64748B">Risk Level:</span> <strong>${fd.riskLevel || '—'}</strong></div>
            </div>
          </div>
          <p style="font-size:12px;color:#94A3B8;margin:0">
            NYC Lead Inspections · 208 Meserole Street Brooklyn NY 11206 · (646) 496-7039<br>
            View dashboard: <a href="https://nyc-lead-inspect.vercel.app" style="color:#185FA5">nyc-lead-inspect.vercel.app</a>
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

  } catch(err) {
    console.error('Email send error:', err)
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
    // Fetch inspection from database
    const { data: insp, error } = await supabase
      .from('inspections')
      .select('*')
      .eq('id', inspectionId)
      .single()

    if (error || !insp) return res.status(404).json({ error: 'Inspection not found' })

    const labData = insp.lab_data || null
    const summaries = await generateSectionSummaries(insp, labData)
    let logoB64 = null
    try {
      const logoBuf = fs.readFileSync(path.join(process.cwd(), 'public', 'logo.png'))
      logoB64 = `data:image/png;base64,${logoBuf.toString('base64')}`
    } catch (_) {}
    const html = buildReportHTML(insp, labData, summaries, logoB64)

    // Launch headless Chromium
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    })

    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle0' })

    const FOOTER_TEXT = 'NYC Lead Inspections · 208 Meserole Street Brooklyn NY 11206 · (646) 496-7039 · info@mindfulsolutionsny.com · www.mindfulsolutionsny.com'
    const pdfBuffer = await page.pdf({
      format: 'Letter',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `<div style="width:100%;text-align:center;font-size:9px;font-family:Helvetica,Arial,sans-serif;color:#94A3B8;border-top:1px solid #E2E8F0;padding:4px 20px;box-sizing:border-box">${FOOTER_TEXT}</div>`,
      margin: { top: '0', right: '0', bottom: '28px', left: '0' }
    })

    await browser.close()

    // Merge PDFs: report → COC → lab results → license
    const merged = await PDFDocument.create()

    async function appendPdf(base64OrBuffer) {
      try {
        const buf = typeof base64OrBuffer === 'string'
          ? Buffer.from(base64OrBuffer, 'base64')
          : base64OrBuffer
        const doc = await PDFDocument.load(buf, { ignoreEncryption: true })
        const pages = await merged.copyPages(doc, doc.getPageIndices())
        pages.forEach(p => merged.addPage(p))
      } catch (e) {
        console.warn('Could not append PDF section:', e.message)
      }
    }

    await appendPdf(pdfBuffer)
    if (labData?.cocPdfBase64)  await appendPdf(labData.cocPdfBase64)
    if (labData?.labPdfBase64)  await appendPdf(labData.labPdfBase64)

    // Append inspector's individual certificate (PDF or JPG)
    try {
      const normName = (insp.inspector_name || '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      const certsDir = path.join(process.cwd(), 'public', 'certs')
      const pdfCert = path.join(certsDir, `${normName}.pdf`)
      const jpgCert = path.join(certsDir, `${normName}.jpg`)
      if (fs.existsSync(pdfCert)) {
        await appendPdf(fs.readFileSync(pdfCert))
      } else if (fs.existsSync(jpgCert)) {
        const tmpDoc = await PDFDocument.create()
        const font = await tmpDoc.embedFont(StandardFonts.Helvetica)
        const boldFont = await tmpDoc.embedFont(StandardFonts.HelveticaBold)
        const img = await tmpDoc.embedJpg(fs.readFileSync(jpgCert))
        const { width, height } = img.scale(1)
        const sigAreaHeight = 95
        const imageAreaHeight = 792 - sigAreaHeight
        const scale = Math.min(612 / width, imageAreaHeight / height)
        const w = width * scale; const h = height * scale
        const p = tmpDoc.addPage([612, 792])
        p.drawImage(img, { x: (612 - w) / 2, y: sigAreaHeight + (imageAreaHeight - h) / 2, width: w, height: h })

        const inspName = insp.inspector_name || ''
        const inspDate = insp.inspection_date || ''
        const inspTime = (insp.form_data || {}).inspTime || ''
        const dateStr = inspDate + (inspTime ? '   ' + inspTime : '')

        p.drawLine({ start: { x: 40, y: 87 }, end: { x: 572, y: 87 }, thickness: 0.5, color: rgb(0.75, 0.75, 0.75) })
        p.drawText('Inspector:', { x: 40, y: 68, size: 9, font, color: rgb(0.45, 0.45, 0.45) })
        p.drawText(inspName, { x: 105, y: 68, size: 10, font: boldFont, color: rgb(0.05, 0.05, 0.05) })
        p.drawText('Date of Inspection:', { x: 360, y: 68, size: 9, font, color: rgb(0.45, 0.45, 0.45) })
        p.drawText(dateStr, { x: 360, y: 54, size: 10, font: boldFont, color: rgb(0.05, 0.05, 0.05) })
        p.drawText('Signature:', { x: 40, y: 34, size: 9, font, color: rgb(0.45, 0.45, 0.45) })
        p.drawLine({ start: { x: 105, y: 32 }, end: { x: 572, y: 32 }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) })

        await appendPdf(Buffer.from(await tmpDoc.save()))
      }
    } catch (e) {
      console.warn('Inspector certificate error:', e.message)
    }

    // Append company license
    try {
      const licenseBuf = fs.readFileSync(path.join(process.cwd(), 'public', 'license.pdf'))
      await appendPdf(licenseBuf)
    } catch (e) {
      console.warn('License file not found, skipping')
    }

    const mergedBytes = await merged.save()
    const finalPdfBuffer = Buffer.from(mergedBytes)

    // Send email with merged PDF attached
    const emailSent = await sendReportEmail(finalPdfBuffer, insp)

    // Update inspection with report generated timestamp and stored HTML
    await supabase
      .from('inspections')
      .update({ status: 'complete', updated_at: new Date().toISOString(), report_html: html })
      .eq('id', inspectionId)

    return res.status(200).json({ success: true, emailSent, pdfSize: pdfBuffer.length })

  } catch(err) {
    console.error('Report generation error:', err)
    return res.status(500).json({ error: err.message })
  }
}

export const config = {
  api: { responseLimit: '10mb' }
}
