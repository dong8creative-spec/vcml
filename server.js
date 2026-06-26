require('dotenv').config({ path: require('path').join(__dirname, '.env') })
const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')
const db = require('./db/schema')

const app = express()
app.use(cors())
app.use(express.json({ limit: '12mb' }))

// ── 동적 사이트맵 ──
app.get('/sitemap.xml', async (req, res) => {
  try {
    const courses = await db.getCourses(false)
    const today = new Date().toISOString().slice(0, 10)
    const staticPages = [
      { url: 'https://vcml.kr/', priority: '1.0', changefreq: 'weekly' },
      { url: 'https://vcml.kr/instructors.html', priority: '0.7', changefreq: 'monthly' },
      { url: 'https://vcml.kr/refund.html', priority: '0.5', changefreq: 'monthly' },
      { url: 'https://vcml.kr/privacy.html', priority: '0.5', changefreq: 'monthly' },
      { url: 'https://vcml.kr/terms.html', priority: '0.5', changefreq: 'monthly' },
    ]
    const coursePages = (courses || [])
      .filter(c => c.is_published)
      .map(c => ({ url: `https://vcml.kr/course.html?slug=${encodeURIComponent(c.slug)}`, priority: '0.9', changefreq: 'weekly' }))
    const all = [...staticPages, ...coursePages]
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${all.map(p =>
      `  <url>\n    <loc>${p.url}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`
    ).join('\n')}\n</urlset>`
    res.setHeader('Content-Type', 'application/xml; charset=utf-8')
    res.setHeader('Cache-Control', 'public, max-age=3600')
    res.send(xml)
  } catch (e) {
    res.status(500).send('sitemap error')
  }
})

// ── 강의 상세 페이지 SEO: slug별 메타태그 서버사이드 주입 ──
const courseHtmlTemplate = fs.readFileSync(path.join(__dirname, 'public', 'course.html'), 'utf8')

app.get('/course.html', async (req, res) => {
  const slug = req.query.slug
  if (!slug) return res.send(courseHtmlTemplate)
  try {
    const course = await db.getCourseBySlug(slug)
    if (!course) return res.send(courseHtmlTemplate)

    const title = `${course.title} — 타닥클래스`
    const desc = (course.description || '').replace(/\n/g, ' ').slice(0, 160)
    const url = `https://vcml.kr/course.html?slug=${encodeURIComponent(slug)}`
    const image = course.thumbnail_url || 'https://vcml.kr/images/og-default.png'
    const priceStr = course.sale_price > 0
      ? `${course.sale_price.toLocaleString()}원`
      : course.price > 0 ? `${course.price.toLocaleString()}원` : '무료'

    const metaTags = `
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc || title)}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(desc || title)}" />
  <meta property="og:url" content="${esc(url)}" />
  <meta property="og:image" content="${esc(image)}" />
  <meta property="og:site_name" content="타닥클래스" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(desc || title)}" />
  <meta name="twitter:image" content="${esc(image)}" />
  <meta name="robots" content="index, follow" />
  <link rel="canonical" href="${esc(url)}" />
  <script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Course",
    "name": course.title,
    "description": desc,
    "url": url,
    "provider": { "@type": "Organization", "name": "타닥클래스", "url": "https://vcml.kr" },
    "offers": { "@type": "Offer", "price": course.sale_price || course.price || 0, "priceCurrency": "KRW", "availability": "https://schema.org/InStock" },
    "image": image,
  })}</script>`

    // 기존 <title> 태그를 제거하고 메타태그 주입
    const html = courseHtmlTemplate
      .replace(/<title>[^<]*<\/title>/, '')
      .replace('</head>', metaTags + '\n</head>')

    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    res.send(html)
  } catch (e) {
    res.send(courseHtmlTemplate)
  }
})

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    } else if (/\.(?:js|css|png|jpg|jpeg|webp|gif|svg|woff2?)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    }
  }
}))

app.use('/api/auth',     require('./routes/auth'))
app.use('/api/courses',  require('./routes/courses'))
app.use('/api/orders',   require('./routes/orders'))
app.use('/api/my',       require('./routes/my'))
app.use('/api/admin',    require('./routes/admin'))
app.use('/api/editor',   require('./routes/editor'))
app.use('/api/projects', require('./routes/project'))
app.use('/api/messages', require('./routes/messages'))
app.use('/api/reviews',  require('./routes/reviews'))
app.use('/api/anticipation', require('./routes/anticipation'))
app.use('/api',          require('./routes/public'))

// SPA fallback — 없는 경로는 index.html로
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' })
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

// 로컬 개발 시에만 listen
if (require.main === module) {
  const PORT = process.env.PORT || 3300
  app.listen(PORT, () => console.log(`✓ 타닥클래스 서버 실행 중: http://localhost:${PORT}`))
}

module.exports = app
