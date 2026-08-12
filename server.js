require('dotenv').config({ path: require('path').join(__dirname, '.env') })
const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')
const db = require('./db')

const app = express()
app.use(cors())
app.use(express.json({ limit: '12mb' }))

// 실서비스 도메인은 여기 한 곳에서만 정한다 — routes/subtitle.js와 동일한 관례(SITE_ORIGIN).
// 도메인이 바뀌어도 이 env var 하나만 바꾸면 사이트맵·canonical·OG·JSON-LD가 전부 따라간다.
const SITE_ORIGIN = (process.env.SITE_ORIGIN || 'https://vcml.kr').replace(/\/$/, '')

/** 강의 상세 페이지의 정식 URL(클린 경로). */
function courseUrl(slug) {
  return `${SITE_ORIGIN}/courses/${encodeURIComponent(slug)}`
}

// ── 레거시 경로 리다이렉트 인프라 ──
// 경로 구조 개편 시, 예전 주소 → 새 주소 매핑을 여기 한 곳에 추가하면 된다.
// 지금은 확정된 신규 경로가 없어 비어 있지만, 검색엔진 색인·외부 공유 링크 보호를 위해
// 뼈대를 먼저 마련해둔다(구조만 있고 지금은 아무 요청 흐름도 바꾸지 않음).
const LEGACY_REDIRECTS = {
  // '/course.html?slug=example': '/courses/example', // 예시 — 실제 매핑은 확정 후 추가
}
app.use((req, res, next) => {
  const key = req.originalUrl
  const target = LEGACY_REDIRECTS[key] || LEGACY_REDIRECTS[req.path]
  if (target) return res.redirect(301, target)
  next()
})

// ── 동적 사이트맵 ──
app.get('/sitemap.xml', async (req, res) => {
  try {
    const [courses, blogPosts] = await Promise.all([
      db.getCourses(false),
      db.getBlogPosts({ publicOnly: true }),
    ])
    const today = new Date().toISOString().slice(0, 10)
    const staticPages = [
      { url: `${SITE_ORIGIN}/`, priority: '1.0', changefreq: 'weekly' },
      { url: `${SITE_ORIGIN}/courses`, priority: '0.9', changefreq: 'weekly' },
      { url: `${SITE_ORIGIN}/free.html`, priority: '0.9', changefreq: 'weekly' },
      { url: `${SITE_ORIGIN}/instructor`, priority: '0.7', changefreq: 'monthly' },
      { url: `${SITE_ORIGIN}/reviews`, priority: '0.7', changefreq: 'weekly' },
      { url: `${SITE_ORIGIN}/blog`, priority: '0.7', changefreq: 'weekly' },
      { url: `${SITE_ORIGIN}/faq`, priority: '0.5', changefreq: 'monthly' },
      { url: `${SITE_ORIGIN}/policy/refund`, priority: '0.5', changefreq: 'monthly' },
      { url: `${SITE_ORIGIN}/policy/privacy`, priority: '0.5', changefreq: 'monthly' },
      { url: `${SITE_ORIGIN}/policy/terms`, priority: '0.5', changefreq: 'monthly' },
    ]
    const coursePages = (courses || [])
      .filter(c => c.is_published)
      .map(c => ({ url: courseUrl(c.slug), priority: '0.9', changefreq: 'weekly' }))
    const blogPages = (blogPosts || [])
      .map(p => ({ url: `${SITE_ORIGIN}/blog/${encodeURIComponent(p.slug)}`, priority: '0.6', changefreq: 'monthly' }))
    const all = [...staticPages, ...coursePages, ...blogPages]
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

async function renderCoursePage(slug, res) {
  if (!slug) return res.send(courseHtmlTemplate)
  try {
    const course = await db.getCourseBySlug(slug)
    if (!course) return res.status(404).send(courseHtmlTemplate)

    const title = `${course.title} — 타닥클래스`
    const desc = (course.description || '').replace(/\n/g, ' ').slice(0, 160)
    const url = courseUrl(slug)
    const image = course.thumbnail_url || `${SITE_ORIGIN}/images/og-default.png`
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
    "provider": { "@type": "Organization", "name": "타닥클래스", "url": SITE_ORIGIN },
    "offers": { "@type": "Offer", "price": course.sale_price || course.price || 0, "priceCurrency": "KRW", "availability": "https://schema.org/InStock" },
    "image": image,
    ...(course.review_count >= 1 ? {
      "aggregateRating": {
        "@type": "AggregateRating",
        "ratingValue": String(course.rating || 0),
        "reviewCount": String(course.review_count),
        "bestRating": "5",
        "worstRating": "1"
      }
    } : {}),
  })}</script>`

    // 기존 <title> 태그를 제거하고 메타태그 + SSR 본문 주입
    // 스피너 대신 SSR 콘텐츠를 초기 상태로 렌더링 — JS 로드 후 course-wrap이 덮어씀
    const ssrBody = `<div id="course-ssr-stub" style="padding:48px 24px;max-width:800px;margin:0 auto;">
  <h1 style="font-size:28px;font-weight:800;color:#111;margin:0 0 16px;">${esc(course.title)}</h1>
  ${desc ? `<p style="font-size:16px;color:#555;line-height:1.7;margin:0 0 12px;">${esc(desc)}</p>` : ''}
  ${priceStr ? `<p style="font-size:15px;color:#888;">수강료: ${esc(priceStr)}</p>` : ''}
</div>`
    const html = courseHtmlTemplate
      .replace(/<title>[^<]*<\/title>/, '')
      .replace('</head>', metaTags + '\n</head>')
      .replace('<div id="course-wrap"><div class="spinner"></div></div>', '<div id="course-wrap">' + ssrBody + '</div>')

    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    res.send(html)
  } catch (e) {
    res.send(courseHtmlTemplate)
  }
}

// 클린 경로(정식 URL) — sitemap·canonical·공유 링크가 전부 이 형태를 가리킨다.
app.get('/courses', (req, res) => res.sendFile(path.join(__dirname, 'public', 'courses.html')))
app.get('/courses/:slug', async (req, res) => renderCoursePage(req.params.slug, res))

// 예전 쿼리스트링 방식 — 이미 배포된 링크·캐시가 있을 수 있어 계속 지원한다(신규 링크 생성엔 사용 안 함).
app.get('/course.html', async (req, res) => renderCoursePage(req.query.slug, res))

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ── 홈페이지 SSR — 강의 목록을 HTML에 직접 삽입 ──
const INDEX_HTML_PATH = path.join(__dirname, 'public', 'index.html')
let indexHtmlTemplate = fs.readFileSync(INDEX_HTML_PATH, 'utf8')

function getIndexHtml() {
  if (process.env.NODE_ENV !== 'production') {
    return fs.readFileSync(INDEX_HTML_PATH, 'utf8')
  }
  return indexHtmlTemplate
}

app.get('/', async (req, res) => {
  try {
    const courses = await db.getCourses(true)
    const published = (courses || []).filter(c => c.is_published !== false)

    const ssrCards = published.map(c => {
      const price = c.sale_price > 0 ? `${c.sale_price.toLocaleString()}원` : c.price > 0 ? `${c.price.toLocaleString()}원` : '무료'
      const thumb = c.thumbnail_url ? `<img src="${esc(c.thumbnail_url)}" alt="${esc(c.title)}" loading="lazy" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:10px 10px 0 0;">` : ''
      return `<a href="/courses/${esc(c.slug)}" class="ssr-course-card" style="display:block;background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden;text-decoration:none;">
  ${thumb}
  <div style="padding:16px;">
    <p style="font-size:12px;color:var(--text-hint);margin:0 0 6px;">${esc(c.category || '')}</p>
    <h3 style="font-size:16px;font-weight:700;color:var(--text-primary);margin:0 0 8px;line-height:1.4;">${esc(c.title)}</h3>
    <p style="font-size:13px;color:var(--text-secondary);margin:0 0 12px;line-height:1.5;">${esc((c.description || '').slice(0, 80))}</p>
    <p style="font-size:15px;font-weight:700;color:var(--primary);margin:0;">${esc(price)}</p>
  </div>
</a>`
    }).join('\n')

    const ssrGrid = ssrCards
      ? `<div id="course-grid-332-ssr" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px;">${ssrCards}</div>`
      : ''

    const html = getIndexHtml()
      .replace(
        '<div class="course-grid-332" id="course-grid-332">\n      <div class="spinner"></div>\n    </div>',
        `<div class="course-grid-332" id="course-grid-332">${ssrGrid}</div>`
      )

    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    res.send(html)
  } catch (e) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'))
  }
})

// ── 그 외 클린 경로 ──
app.get('/instructor', (req, res) => res.sendFile(path.join(__dirname, 'public', 'instructors.html')))
app.get('/reviews', (req, res) => res.sendFile(path.join(__dirname, 'public', 'reviews.html')))
app.get('/faq', (req, res) => res.sendFile(path.join(__dirname, 'public', 'faq.html')))
app.get('/policy/refund',  (req, res) => res.sendFile(path.join(__dirname, 'public', 'refund.html')))
app.get('/policy/terms',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'terms.html')))
app.get('/policy/privacy', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')))

// ── 블로그: 목록은 정적, 상세는 slug별 메타태그 서버사이드 주입(검색 유입 대응) ──
const blogPostHtmlTemplate = fs.readFileSync(path.join(__dirname, 'public', 'blog-post.html'), 'utf8')

app.get('/blog', (req, res) => res.sendFile(path.join(__dirname, 'public', 'blog.html')))
app.get('/blog/:slug', async (req, res) => {
  try {
    const post = await db.getBlogPostBySlug(req.params.slug)
    if (!post || !post.is_published) return res.status(404).send(blogPostHtmlTemplate)

    const title = `${post.title} — 타닥클래스 블로그`
    const desc = (post.excerpt || post.content || '').replace(/\n/g, ' ').slice(0, 160)
    const url = `${SITE_ORIGIN}/blog/${encodeURIComponent(post.slug)}`
    const image = post.cover_image || `${SITE_ORIGIN}/images/og-default.png`

    const metaTags = `
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc || title)}" />
  <meta property="og:type" content="article" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(desc || title)}" />
  <meta property="og:url" content="${esc(url)}" />
  <meta property="og:image" content="${esc(image)}" />
  <meta property="og:site_name" content="타닥클래스" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(desc || title)}" />
  <meta name="robots" content="index, follow" />
  <link rel="canonical" href="${esc(url)}" />
  <script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": post.title,
    "description": desc,
    "url": url,
    "image": image,
    "datePublished": post.created_at,
    "dateModified": post.updated_at || post.created_at,
    "publisher": { "@type": "Organization", "name": "타닥클래스", "url": SITE_ORIGIN },
  })}</script>`

    const d = post.created_at ? new Date(post.created_at) : null
    const dateStr = d ? `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.` : ''
    const ssrBody = `
  <a href="/blog" class="post-back"><i class="ti ti-arrow-left"></i> 블로그 목록</a>
  <h1 class="post-title">${esc(post.title)}</h1>
  <div class="post-meta">타닥클래스 &nbsp;·&nbsp; ${esc(dateStr)}</div>
  ${post.cover_image ? `<img class="post-cover" src="${esc(post.cover_image)}" alt="${esc(post.title)}">` : ''}
  <div class="post-body">${esc(post.content)}</div>
  <div class="post-nav"><a href="/blog"><i class="ti ti-list"></i> 목록으로</a></div>`

    const html = blogPostHtmlTemplate
      .replace(/<title>[^<]*<\/title>/, '')
      .replace('</head>', metaTags + '\n</head>')
      .replace('<div class="post-wrap" id="post-wrap"><div class="spinner"></div></div>',
               '<div class="post-wrap" id="post-wrap">' + ssrBody + '</div>')

    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    res.send(html)
  } catch (e) {
    res.send(blogPostHtmlTemplate)
  }
})

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    } else if (/\.(?:js|css|png|jpg|jpeg|webp|gif|svg|woff2?)$/i.test(filePath)) {
      const isDev = process.env.NODE_ENV !== 'production'
      res.setHeader('Cache-Control', isDev ? 'no-cache, must-revalidate' : 'public, max-age=31536000, immutable')
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
app.use('/api/institution', require('./routes/institution'))
app.use('/api/anticipation', require('./routes/anticipation'))
app.use('/api/subtitle', require('./routes/subtitle'))
app.use('/api',          require('./routes/public'))

app.post('/api/cron/sync-login-logs', async (req, res) => {
  const secret = (process.env.CRON_SECRET || '').trim()
  const header = String(req.headers['x-cron-secret'] || '').trim()
  if (!secret || header !== secret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  try {
    const { runDailySync } = require('./utils/loginLogSheetsCron')
    const { yesterdayKstDateKey } = require('./utils/kstDate')
    const dateKey = String(req.body?.date || req.query?.date || yesterdayKstDateKey()).trim()
    const result = await runDailySync(dateKey)
    if (!result) return res.status(400).json({ error: 'Google Sheets env 미설정' })
    res.json({ ok: true, ...result })
  } catch (e) {
    console.error('cron sync-login-logs:', e)
    res.status(500).json({ error: e.message || '동기화 실패' })
  }
})

// SPA fallback — 없는 경로는 index.html로
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' })
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

// 로컬 개발 시에만 listen
if (require.main === module) {
  const PORT = process.env.PORT || 3300
  app.listen(PORT, () => {
    console.log(`✓ 타닥클래스 서버 실행 중: http://localhost:${PORT}`)
    if (process.env.LOGIN_LOG_SHEETS_CRON === '1') {
      require('./utils/loginLogSheetsCron').scheduleLoginLogSheetsSync()
    }
  })
}

module.exports = app
