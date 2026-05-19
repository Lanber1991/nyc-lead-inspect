import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'
import { PDFDocument } from 'pdf-lib'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export default async function handler(req, res) {
  const { id } = req.query
  if (req.method !== 'GET') return res.status(405).end()

  const { data: insp, error } = await supabase
    .from('inspections')
    .select('work_plan_data, report_number, property_address')
    .eq('id', id)
    .single()

  if (error || !insp) return res.status(404).json({ error: 'Not found' })

  const wp = insp.work_plan_data
  if (!wp) return res.status(404).json({ error: 'No work plan found — generate it first' })

  const coverHtml = wp.coverHtml
  const contentHtml = wp.contentHtml || wp.html
  if (!contentHtml) return res.status(404).json({ error: 'No work plan HTML found — regenerate the work plan' })

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  })

  const workPlanNumber = wp.workPlanNumber || insp.report_number
  const headerTpl = `<div style="width:100%;background:#0E2A50;color:white;font-family:Helvetica,Arial,sans-serif;font-size:9pt;display:flex;justify-content:space-between;align-items:center;padding:0 36px;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;height:100%"><span>MINDFUL SOLUTIONS NY &nbsp;·&nbsp; Lead Abatement Work Plan</span><span>${workPlanNumber}</span></div>`
  const footerTpl = `<div style="width:100%;font-family:Helvetica,Arial,sans-serif;font-size:7.5pt;color:#64748B;padding:0 36px;box-sizing:border-box;border-top:1px solid #E2E8F0;text-align:center;display:flex;align-items:center;justify-content:center;height:100%">NYC Lead Inspections &nbsp;·&nbsp; 208 Meserole Street, Brooklyn NY 11206 &nbsp;·&nbsp; (646) 496-7039 &nbsp;·&nbsp; info@mindfulsolutionsny.com &nbsp;·&nbsp; www.mindfulsolutionsny.com</div>`

  let pdfBuffer

  if (coverHtml) {
    const coverPage = await browser.newPage()
    await coverPage.setContent(coverHtml, { waitUntil: 'networkidle0' })
    const coverRaw = await coverPage.pdf({
      format: 'Letter', printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' }
    })

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
    pdfBuffer = Buffer.from(await merged.save())
  } else {
    const page = await browser.newPage()
    await page.setContent(contentHtml, { waitUntil: 'networkidle0' })
    const raw = await page.pdf({
      format: 'Letter', printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: headerTpl,
      footerTemplate: footerTpl,
      margin: { top: '52px', right: '36px', bottom: '48px', left: '36px' }
    })
    await browser.close()
    pdfBuffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
  }

  const filename = `Work_Plan_${workPlanNumber}.pdf`
  res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': pdfBuffer.length,
  })
  res.end(pdfBuffer)
}

export const config = {
  api: { responseLimit: '10mb' }
}
