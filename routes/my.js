const router = require('express').Router()
const db = require('../db/schema')
const { authMiddleware } = require('../middleware/auth')

router.get('/courses', authMiddleware, async (req, res) => {
  const enrollments = await db.getEnrollmentsByUser(req.user.id)
  const courses = await Promise.all(enrollments.map(async e => {
    const c = await db.getCourseById(e.course_id)
    if (!c) return null
    const chapters = await db.getChaptersByCourse(c.id)
    const progress = await db.getProgressByCourse(req.user.id, c.id)
    const completed = progress.filter(p => p.completed).length
    return { ...c, enrolled_at: e.enrolled_at, total_chapters: chapters.length, completed_chapters: completed }
  }))
  res.json(courses.filter(Boolean).reverse())
})

router.post('/progress', authMiddleware, async (req, res) => {
  const { chapter_id, completed, watched_sec } = req.body
  const chapter = await db.getChapterById(chapter_id)
  if (!chapter) return res.status(404).json({ error: '챕터 없음' })
  if (!await db.isEnrolled(req.user.id, chapter.course_id)) return res.status(403).json({ error: '수강 신청 필요' })
  await db.upsertProgress(req.user.id, chapter_id, completed, watched_sec || 0)
  res.json({ success: true })
})

router.post('/reviews', authMiddleware, async (req, res) => {
  const { course_id, rating, content } = req.body
  if (!course_id || !rating) return res.status(400).json({ error: '필수 항목 누락' })
  if (!await db.isEnrolled(req.user.id, course_id)) return res.status(403).json({ error: '수강생만 후기를 작성할 수 있습니다.' })
  await db.upsertReview(req.user.id, course_id, rating, content)
  res.json({ success: true })
})

router.get('/coupons', authMiddleware, async (req, res) => {
  const coupons = await db.getCouponsByUser(req.user.id)
  res.json(coupons)
})

router.delete('/marketing-consent', authMiddleware, async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress
  await db.revokeMarketing(req.user.id, ip)
  res.json({ success: true })
})

module.exports = router
