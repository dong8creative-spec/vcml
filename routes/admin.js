const router = require('express').Router()
const db = require('../db/schema')
const { adminMiddleware } = require('../middleware/auth')
const { sendLiveInviteMessage } = require('../utils/kakaoMessage')

router.use(adminMiddleware)

router.get('/stats', async (req, res) => {
  res.json(await db.getStats())
})

router.get('/orders', async (req, res) => {
  const orders = await db.getAllOrders()
  const result = await Promise.all(orders.map(async o => {
    const u = await db.findUserById(o.user_id)
    const c = await db.getCourseById(o.course_id)
    return { ...o, user_name: u?.name, email: u?.email, course_title: c?.title }
  }))
  res.json(result)
})

router.get('/students', async (req, res) => {
  res.json(await db.getAllStudents())
})

router.get('/reviews', async (req, res) => {
  const reviews = await db.getAllReviews()
  const result = await Promise.all(reviews.map(async r => {
    const u = await db.findUserById(r.user_id)
    const c = await db.getCourseById(r.course_id)
    return { ...r, user_name: u?.name, course_title: c?.title }
  }))
  res.json(result)
})

router.patch('/reviews/:id', async (req, res) => {
  await db.updateReviewPublic(req.params.id, req.body.is_public)
  res.json({ success: true })
})

router.delete('/reviews/:id', async (req, res) => {
  await db.deleteReview(req.params.id)
  res.json({ success: true })
})

router.patch('/courses/:id', async (req, res) => {
  const { title, sale_price, is_published, course_type, live_schedule, meet_code, live_status } = req.body
  const update = {}
  if (title !== undefined) update.title = title
  if (sale_price !== undefined) update.sale_price = sale_price
  if (is_published !== undefined) update.is_published = is_published
  if (course_type !== undefined) update.course_type = course_type
  if (live_schedule !== undefined) update.live_schedule = live_schedule
  if (meet_code !== undefined) update.meet_code = meet_code
  if (live_status !== undefined) update.live_status = live_status
  await db.updateCourse(req.params.id, update)
  res.json({ success: true })
})

router.post('/live-courses', async (req, res) => {
  const { title, description, category, thumbnail_icon, live_schedule, meet_code } = req.body
  if (!title || !category) return res.status(400).json({ error: '제목과 카테고리는 필수입니다.' })
  const course = await db.createLiveCourse({ title, description, category, thumbnail_icon, live_schedule, meet_code })
  res.json({ success: true, course })
})

router.post('/courses/:id/send-live-invite', async (req, res) => {
  const course = await db.getCourseById(req.params.id)
  if (!course) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
  if (course.course_type !== 'live') return res.status(400).json({ error: '라이브 강의가 아닙니다.' })
  if (!course.meet_code) return res.status(400).json({ error: 'Google Meet 코드를 먼저 입력해주세요.' })
  if (!course.live_schedule) return res.status(400).json({ error: '라이브 일정을 먼저 입력해주세요.' })

  const enrollments = await db.getEnrollmentsByCourse(course.id)
  const results = { sent: 0, skipped: 0, failed: 0, skipped_users: [] }

  for (const e of enrollments) {
    const user = await db.findUserById(e.user_id)
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

router.get('/course-stats', async (req, res) => {
  res.json(await db.getCourseStats())
})

module.exports = router
