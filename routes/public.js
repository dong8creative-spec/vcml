const router = require('express').Router()
const db = require('../db/schema')

function publicCache(req, res, next) {
  if (req.method === 'GET') {
    res.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120')
  }
  next()
}

router.use(publicCache)

// 공지사항 공개 API
router.get('/notices', async (req, res) => {
  const notices = await db.getNotices({ publicOnly: true })
  res.json(notices)
})
router.get('/notices/:id', async (req, res) => {
  const notice = await db.getNoticeById(req.params.id)
  if (!notice || !notice.is_public) return res.status(404).json({ error: '공지를 찾을 수 없습니다.' })
  res.json(notice)
})

// FAQ 공개 API
router.get('/faqs', async (req, res) => {
  const faqs = await db.getFaqs({ publicOnly: true })
  res.json(faqs)
})

// 1:1 문의 제출 API
router.post('/support/tickets', async (req, res) => {
  const { name, email, type, subject, content, user_id } = req.body
  if (!name || !email || !subject || !content) {
    return res.status(400).json({ error: '이름, 이메일, 제목, 내용은 필수입니다.' })
  }
  const ticket = await db.createTicket({ name, email, type, subject, content, user_id: user_id || null })
  res.json({ success: true, ticket_id: ticket.id })
})

router.get('/stats', async (req, res) => {
  try {
    res.json(await db.getPublicSiteStats())
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/homepage-layout', async (req, res) => {
  try {
    res.json(await db.getHomepageLayout())
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/footer', async (req, res) => {
  try {
    res.json(await db.getFooterConfig())
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/hero', async (req, res) => {
  try {
    res.json(await db.getHeroConfig())
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/instructors', async (req, res) => {
  try {
    const [intro, instructors] = await Promise.all([
      db.getInstructorsIntro(),
      db.getInstructors({ publicOnly: true }),
    ])
    res.json({ intro, instructors })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/recent-orders', async (req, res) => {
  try {
    const orders = await db.getRecentPublicOrders(20)
    res.json({ orders })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 홈페이지 전체 데이터를 한 번에 반환 — API 요청 5개 → 1개로 줄임
router.get('/homepage', async (req, res) => {
  try {
    const cached = db._cacheGet('homepage:data')
    if (cached) return res.json(cached)
    const [hero, courses, layout, orders, platformReviews] = await Promise.all([
      db.getHeroConfig(),
      db.getCourses(true),
      db.getHomepageLayout(),
      db.getRecentPublicOrders(20),
      db.getPlatformReviewsByTypes(['student', 'client', 'editor']).catch(() => []),
    ])
    const TYPE_LABEL = { student: '수강생 후기', client: '의뢰인 후기', editor: '에디터즈 후기' }
    const liveReviews = platformReviews.map(r => ({
      id: r.id, review_type: r.review_type,
      type_label: TYPE_LABEL[r.review_type] || r.review_type,
      author_name: r.author_name, author_initial: r.author_initial,
      content: r.content, rating: r.rating || 5,
      context_label: r.context_label, created_at: r.created_at,
    }))
    const data = { hero, courses: courses.map(db.pickCourseCardFields), layout, orders: orders || [], liveReviews }
    db._cacheSet('homepage:data', data, 30_000)
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
