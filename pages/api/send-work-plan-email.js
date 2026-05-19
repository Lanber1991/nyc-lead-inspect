import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'
import { PDFDocument } from 'pdf-lib'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

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
  const footerTpl = `<div style="width:100%;font-family:Helvetica,Arial,sans-serif;font-size:7.5pt;color:#64748B;padding:0 36px;box-sizing:border-box;border-top:1px solid #E2E8F0;text-align:center;display:flex;align-items:center;justify-content:center;height:100%">NYC Lead Inspections &nbsp;·&nbsp; 208 Meserole Street, Brooklyn NY 11206 &nbsp;·&nbsp; (646) 496-7039 &nbsp;·&nbsp; info@mindfulsolutionsny.com &nbsp;·&nbsp; www.mindfulsolutionsny.com</div>`

  const contentPage = await browser.newPage()
  await contentPage.setContent(contentHtml, { waitUntil: 'networkidle0' })
  const contentRaw = await contentPage.pdf({
    format: 'Letter', printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: headerTpl,
    footerTemplate: footerTpl,
    margin: { top: '52px', right: '36px', bottom: '48px', left: '36px' }
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { inspectionId } = req.body
  if (!inspectionId) return res.status(400).json({ error: 'inspectionId required' })

  const { data: insp, error } = await supabase
    .from('inspections')
    .select('*')
    .eq('id', inspectionId)
    .single()

  if (error || !insp) return res.status(404).json({ error: 'Inspection not found' })

  const wp = insp.work_plan_data
  if (!wp?.contentHtml) return res.status(400).json({ error: 'No work plan found — generate it first' })

  try {
    const pdfBuffer = await renderWorkPlanPdf(wp.coverHtml, wp.contentHtml, wp.workPlanNumber)

    const fd = insp.form_data || {}
    const inspectorEmail = fd.inspEmail || ''
    const pdfBase64 = pdfBuffer.toString('base64')
    const filename = `Work_Plan_${wp.workPlanNumber}_${insp.property_address.replace(/[^a-z0-9]/gi, '_').slice(0, 30)}.pdf`
    const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

    const toAddresses = ['reports@mindfulsolutionsny.com']
    if (inspectorEmail && inspectorEmail.includes('@')) toAddresses.push(inspectorEmail)

    const accessToken = await getGmailAccessToken()
    if (!accessToken) return res.status(500).json({ error: 'Gmail auth failed' })

    const boundary = 'boundary_' + Date.now()
    const emailLines = [
      `From: reports@mindfulsolutionsny.com`,
      `To: ${toAddresses.join(', ')}`,
      `Subject: Work Plan Approved: ${wp.workPlanNumber} — ${insp.property_address}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      ``,
      `--${boundary}`,
      `Content-Type: text/html; charset=utf-8`,
      ``,
      `<html><body style="font-family:system-ui,sans-serif;padding:20px;max-width:560px">
        <div style="background:#0E2A50;color:white;padding:16px 20px;border-radius:8px 8px 0 0">
          <div style="font-size:16px;font-weight:600">Lead Abatement Work Plan — Reviewed & Approved</div>
          <div style="font-size:12px;color:#93C5FD;margin-top:4px">${wp.workPlanNumber} · ${dateStr}</div>
        </div>
        <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:0 0 8px 8px;padding:20px">
          <p style="font-size:14px;color:#374151;margin-bottom:16px">
            The attached Lead Abatement Work Plan for <strong>${insp.property_address}</strong> has been reviewed and approved by the licensed mold assessor.
          </p>
          <div style="background:white;border:1px solid #E2E8F0;border-radius:6px;padding:12px 16px;margin-bottom:16px">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px">
              <div><span style="color:#64748B">Client:</span> <strong>${insp.client_name || '—'}</strong></div>
              <div><span style="color:#64748B">Inspector:</span> <strong>${insp.inspector_name}</strong></div>
              <div><span style="color:#64748B">Property:</span> <strong>${insp.property_address}</strong></div>
              <div><span style="color:#64748B">Level:</span> <strong>${wp.overallRemediationLevel}</strong></div>
              <div><span style="color:#64748B">Total Sq Ft:</span> <strong>${wp.totalAffectedSqft} sf</strong></div>
              <div><span style="color:#64748B">Est. Duration:</span> <strong>${wp.estimatedDuration}</strong></div>
            </div>
          </div>
          <p style="font-size:11px;color:#94A3B8;margin:0">
            NYC Lead Inspections · 208 Meserole Street, Brooklyn NY 11206 · (646) 496-7039
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

    if (!sendRes.ok) {
      const err = await sendRes.json()
      console.error('Gmail send error:', err)
      return res.status(500).json({ error: 'Email send failed' })
    }

    // Record that email was sent
    await supabase
      .from('inspections')
      .update({ work_plan_data: { ...wp, emailSentAt: new Date().toISOString() }, updated_at: new Date().toISOString() })
      .eq('id', inspectionId)

    return res.status(200).json({ success: true })

  } catch (err) {
    console.error('Send work plan email error:', err)
    return res.status(500).json({ error: err.message })
  }
}

export const config = {
  api: { responseLimit: '10mb' }
}
