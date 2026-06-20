const router = require('express').Router()
const db = require('../db/schema')
const { adminMiddleware } = require('../middleware/auth')
const { sendLiveInviteMessage } = require('../utils/kakaoMessage')

router.use(adminMiddleware)

router.get('/stats', (req, res) => {
  res.json(db.getStats())
})

router.get('/orders', (req, res) => {
  const orders = db.getAllOrders().map(o => {
    const u = db.findUserById(o.user_id)
    const c = db.getCourseById(o.course_id)
    return { ...o, user_name: u?.name, email: u?.email, course_title: c?.title }
  })
  res.json(orders)
})

router.get('/students', (req, res) => {
  res.json(db.getAllStudents())
})

router.get('/reviews', (req, res) => {
  const reviews = db.getAllReviews().map(r => {
    const u = db.findUserById(r.user_id)
    const c = db.getCourseById(r.course_id)
    return { ...r, user_name: u?.name, course_title: c?.title }
  })
  res.json(reviews)
})

router.patch('/reviews/:id', (req, res) => {
  db.updateReviewPublic(parseInt(req.params.id), req.body.is_public)
  res.json({ success: true })
})

router.delete('/reviews/:id', (req, res) => {
  db.deleteReview(parseInt(req.params.id))
  res.json({ success: true })
})

router.patch('/courses/:id', (req, res) => {
  const { title, sale_price, is_published, course_type, live_schedule, meet_code, live_status } = req.body
  const update = {}
  if (title !== undefined) update.title = title
  if (sale_price !== undefined) update.sale_price = sale_price
  if (is_published !== undefined) update.is_published = is_published
  if (course_type !== undefined) update.course_type = course_type
  if (live_schedule !== undefined) update.live_schedule = live_schedule
  if (meet_code !== undefined) update.meet_code = meet_code
  if (live_status !== undefined) update.live_status = live_status
  db.updateCourse(parseInt(req.params.id), update)
  res.json({ success: true })
})

// 라이브 강의 등록
router.post('/live-courses', (req, res) => {
  const { title, description, category, thumbnail_icon, live_schedule, meet_code } = req.body
  if (!title || !category) return res.status(400).json({ error: '제목과 카테고리는 필수입니다.' })
  const course = db.createLiveCourse({ title, description, category, thumbnail_icon, live_schedule, meet_code })
  res.json({ success: true, course })
})

// 라이브 강의 — 수강생 전체에게 Meet 코드 알림톡 발송
router.post('/courses/:id/send-live-invite', async (req, res) => {
  const course = db.getCourseById(parseInt(req.params.id))
  if (!course) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
  if (course.course_type !== 'live') return res.status(400).json({ error: '라이브 강의가 아닙니다.' })
  if (!course.meet_code) return res.status(400).json({ error: 'Google Meet 코드를 먼저 입력해주세요.' })
  if (!course.live_schedule) return res.status(400).json({ error: '라이브 일정을 먼저 입력해주세요.' })

  const enrollments = db.getEnrollmentsByCourse(course.id)
  const results = { sent: 0, skipped: 0, failed: 0, skipped_users: [] }

  for (const e of enrollments) {
    const user = db.findUserById(e.user_id)
    if (!user) continue
    if (!user.phone) {
      results.skipped++
      results.skipped_users.push(user.name)
      continue
    }
    try {
      await sendLiveInviteMessage(user.phone, user.name, course.title, course.live_schedule, course.meet_code)
      results.sent++
    } catch (err) {
      results.failed++
    }
  }

  res.json({ success: true, ...results })
})

router.get('/course-stats', (req, res) => {
  const stats = db.getCourses(false).map(c => {
    const revenue = db.tables.orders
      .filter(o => o.course_id === c.id && o.status === 'paid')
      .reduce((s, o) => s + o.amount, 0)
    return { id: c.id, title: c.title, sale_price: c.sale_price, student_count: c.student_count || 0, revenue }
  }).sort((a, b) => b.revenue - a.revenue)
  res.json(stats)
})

module.exports = router
