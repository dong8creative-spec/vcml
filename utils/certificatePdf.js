/**
 * 수료증 PDF 생성 (한글: MalgunGothic 또는 NotoSansKR TTF)
 */
const fs = require('fs')
const path = require('path')
const PDFDocument = require('pdfkit')

const FONT_CANDIDATES = [
  path.join(__dirname, '..', 'assets', 'fonts', 'MalgunGothic.ttf'),
  path.join(__dirname, '..', 'assets', 'fonts', 'NotoSansKR-Regular.ttf'),
  'C:\\Windows\\Fonts\\malgun.ttf',
  '/usr/share/fonts/truetype/nanum/NanumGothic.ttf',
]

function resolveKoreanFont() {
  for (const p of FONT_CANDIDATES) {
    try {
      if (fs.existsSync(p)) return p
    } catch {}
  }
  return null
}

function formatIssuedAt(iso) {
  const d = iso ? new Date(iso) : new Date()
  if (Number.isNaN(d.getTime())) {
    const n = new Date()
    return `${n.getFullYear()}년 ${n.getMonth() + 1}월 ${n.getDate()}일`
  }
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`
}

/**
 * @returns {Promise<Buffer>}
 */
function buildCertificatePdf({
  studentName,
  courseTitle,
  progressPct,
  thresholdPct,
  issuedAt,
}) {
  return new Promise((resolve, reject) => {
    const fontPath = resolveKoreanFont()
    if (!fontPath) {
      reject(new Error('한글 폰트를 찾을 수 없습니다. assets/fonts/MalgunGothic.ttf 가 필요합니다.'))
      return
    }

    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 48 })
    const chunks = []
    doc.on('data', (c) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    doc.registerFont('KR', fontPath)
    doc.font('KR')

    const pageW = doc.page.width
    const pageH = doc.page.height

    doc.rect(24, 24, pageW - 48, pageH - 48).lineWidth(2).stroke('#1a1a2e')
    doc.rect(32, 32, pageW - 64, pageH - 64).lineWidth(0.5).stroke('#c4c4d4')

    doc.fontSize(14).fillColor('#666').text('타닥클래스  TADAK CLASS', 0, 72, { align: 'center' })
    doc.fontSize(36).fillColor('#1a1a2e').text('수  료  증', 0, 110, { align: 'center' })
    doc.moveDown(1.2)
    doc.fontSize(16).fillColor('#333').text('Certificate of Completion', { align: 'center' })

    doc.fontSize(18).fillColor('#111').text(
      `위 사람은 「${courseTitle}」 과정을`,
      80,
      210,
      { align: 'center', width: pageW - 160 },
    )
    doc.moveDown(0.6)
    doc.text(
      `챕터 완료율 ${progressPct}%(기준 ${thresholdPct}% 이상)로 수료하였음을 증명합니다.`,
      { align: 'center', width: pageW - 160 },
    )

    doc.fontSize(22).fillColor('#1a1a2e').text(studentName || '수강생', 0, 310, { align: 'center' })

    doc.fontSize(14).fillColor('#555').text(`발급일: ${formatIssuedAt(issuedAt)}`, 0, pageH - 120, {
      align: 'center',
    })
    doc.fontSize(13).fillColor('#888').text('타닥클래스', 0, pageH - 90, { align: 'center' })

    doc.end()
  })
}

module.exports = { buildCertificatePdf, resolveKoreanFont }
