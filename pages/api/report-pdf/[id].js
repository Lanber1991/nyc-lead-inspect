import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'
import { createClient } from '@supabase/supabase-js'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const FOOTER_TEXT = 'NYC Lead Inspections · 208 Meserole Street Brooklyn NY 11206 · (646) 496-7039 · info@mindfulsolutionsny.com · www.mindfulsolutionsny.com'

export default async function handler(req, res) {
  const { id } = req.query
  if (req.method !== 'GET') return res.status(405).end()

  const { data: insp, error } = await supabase
    .from('inspections')
    .select('report_html, report_number, property_address, inspector_name, inspection_date, form_data')
    .eq('id', id)
    .single()

  if (error || !insp) return res.status(404).json({ error: 'Not found' })

  const html = insp.report_html
  if (!html) return res.status(404).json({ error: 'No report found — generate it first' })

  // Derive base URL for fetching static assets (public/ is always available via HTTP)
  const proto = req.headers['x-forwarded-proto'] || 'https'
  const host = req.headers.host
  const baseUrl = `${proto}://${host}`

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  })

  const page = await browser.newPage()
  await page.setContent(html, { waitUntil: 'networkidle0' })

  const pdfRaw = await page.pdf({
    format: 'Letter',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: `<div style="width:100%;text-align:center;font-size:9px;font-family:Helvetica,Arial,sans-serif;color:#94A3B8;border-top:1px solid #E2E8F0;padding:4px 20px;box-sizing:border-box">${FOOTER_TEXT}</div>`,
    margin: { top: '0', right: '0', bottom: '48px', left: '0' }
  })

  await browser.close()

  const pdfBuffer = Buffer.isBuffer(pdfRaw) ? pdfRaw : Buffer.from(pdfRaw)

  const merged = await PDFDocument.create()

  async function appendPdf(buf) {
    try {
      const doc = await PDFDocument.load(buf, { ignoreEncryption: true })
      const pages = await merged.copyPages(doc, doc.getPageIndices())
      pages.forEach(p => merged.addPage(p))
    } catch (e) {
      console.warn('appendPdf error:', e.message)
    }
  }

  async function appendJpgAsPdf(buf) {
    try {
      const tmpDoc = await PDFDocument.create()
      const font = await tmpDoc.embedFont(StandardFonts.Helvetica)
      const boldFont = await tmpDoc.embedFont(StandardFonts.HelveticaBold)
      const img = await tmpDoc.embedJpg(buf)
      const { width, height } = img.scale(1)
      const sigAreaHeight = 95
      const imageAreaHeight = 792 - sigAreaHeight
      const scale = Math.min(612 / width, imageAreaHeight / height)
      const w = width * scale
      const h = height * scale
      const pg = tmpDoc.addPage([612, 792])
      pg.drawImage(img, { x: (612 - w) / 2, y: sigAreaHeight + (imageAreaHeight - h) / 2, width: w, height: h })

      const inspName = insp.inspector_name || ''
      const inspDate = insp.inspection_date || ''
      const inspTime = (insp.form_data || {}).inspTime || ''
      const dateStr = inspDate + (inspTime ? '   ' + inspTime : '')

      pg.drawLine({ start: { x: 40, y: 87 }, end: { x: 572, y: 87 }, thickness: 0.5, color: rgb(0.75, 0.75, 0.75) })
      pg.drawText('Inspector:', { x: 40, y: 68, size: 9, font, color: rgb(0.45, 0.45, 0.45) })
      pg.drawText(inspName, { x: 105, y: 68, size: 10, font: boldFont, color: rgb(0.05, 0.05, 0.05) })
      pg.drawText('Date of Inspection:', { x: 360, y: 68, size: 9, font, color: rgb(0.45, 0.45, 0.45) })
      pg.drawText(dateStr, { x: 360, y: 54, size: 10, font: boldFont, color: rgb(0.05, 0.05, 0.05) })
      pg.drawText('Signature:', { x: 40, y: 34, size: 9, font, color: rgb(0.45, 0.45, 0.45) })
      pg.drawLine({ start: { x: 105, y: 32 }, end: { x: 572, y: 32 }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) })

      await appendPdf(Buffer.from(await tmpDoc.save()))
    } catch (e) {
      console.warn('appendJpgAsPdf error:', e.message)
    }
  }

  // Fetch a static asset from the public/ directory via HTTP (always available on Vercel)
  async function fetchStatic(urlPath) {
    try {
      const r = await fetch(`${baseUrl}${urlPath}`)
      if (!r.ok) return null
      return Buffer.from(await r.arrayBuffer())
    } catch (e) {
      console.warn('fetchStatic error:', urlPath, e.message)
      return null
    }
  }

  // Main report
  await appendPdf(pdfBuffer)

  // Inspector certificate — try PDF then JPG, fetched as static asset
  const normName = (insp.inspector_name || '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  const certPdf = await fetchStatic(`/certs/${normName}.pdf`)
  if (certPdf) {
    await appendPdf(certPdf)
  } else {
    const certJpg = await fetchStatic(`/certs/${normName}.jpg`)
    if (certJpg) await appendJpgAsPdf(certJpg)
  }

  // Company license
  const licensePdf = await fetchStatic('/license.pdf')
  if (licensePdf) await appendPdf(licensePdf)

  const finalBuffer = Buffer.from(await merged.save())

  const filename = `IAQ_Report_${insp.report_number}_${(insp.property_address || '').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`
  res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': finalBuffer.length,
  })
  res.end(finalBuffer)
}

export const config = {
  api: { responseLimit: '25mb' }
}
