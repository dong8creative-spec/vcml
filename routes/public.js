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
    const [hero, courses, layout, orders, platformReviews, allOrders, allReviews] = await Promise.all([
      db.getHeroConfig(),
      db.getCourses(true),
      db.getHomepageLayout(),
      db.getRecentPublicOrders(20),
      db.getPlatformReviewsByTypes(['student', 'client', 'editor']).catch(() => []),
      db.getAllOrders().catch(() => []),
      db.getAllReviews().catch(() => []),
    ])
    const TYPE_LABEL = { student: '수강생 후기', client: '의뢰인 후기', editor: '에디터즈 후기' }
    function maskName(name) {
      if (!name || name.length < 2) return name || '수강생'
      return name[0] + '**'
    }

    // 수강생 후기 — 실제 reviews 컬렉션 (이름·강의명 조인)
    const studentReviews = (allReviews || []).filter(r => r.is_public == 1 && r.content)
    const courseIds = [...new Set(studentReviews.map(r => r.course_id).filter(Boolean))]
    const courseMap = courseIds.length ? await db.batchGetCourses(courseIds) : {}
    const liveFromCourse = await Promise.all(studentReviews.map(async r => {
      const user = await db.findUserById(r.user_id)
      const name = user?.name || ''
      return {
        id: r.id,
        review_type: 'student',
        type_label: TYPE_LABEL.student,
        author_name: maskName(name),
        author_initial: name.trim() ? name.trim()[0] : '수',
        content: r.content,
        rating: r.rating || 5,
        course_title: courseMap[r.course_id]?.title || '',
        created_at: r.created_at,
      }
    }))

    // 의뢰인·에디터즈 후기 — platform_reviews 유지
    const liveFromPlatform = platformReviews
      .filter(r => r.review_type !== 'student')
      .map(r => ({
        id: r.id, review_type: r.review_type,
        type_label: TYPE_LABEL[r.review_type] || r.review_type,
        author_name: maskName(r.author_name), author_initial: r.author_initial || (r.author_name ? r.author_name[0] : '?'),
        content: r.content, rating: r.rating || 5,
        course_title: r.context_label || '', created_at: r.created_at,
      }))

    const liveReviews = [...liveFromCourse, ...liveFromPlatform]
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    const studentCount = new Set((allOrders || []).map(o => o.user_id).filter(Boolean)).size
    const publicReviews = (allReviews || []).filter(r => r.is_public === 1 && r.rating)
    const avgRating = publicReviews.length
      ? (publicReviews.reduce((s, r) => s + r.rating, 0) / publicReviews.length).toFixed(1)
      : null
    const stats = { student_count: studentCount, review_count: publicReviews.length, avg_rating: avgRating }
    const data = { hero, courses: courses.map(db.pickCourseCardFields), layout, orders: orders || [], liveReviews, stats }
    db._cacheSet('homepage:data', data, 30_000)
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
