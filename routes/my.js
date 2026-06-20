const router = require('express').Router()
const db = require('../db/schema')
const { authMiddleware } = require('../middleware/auth')

router.get('/courses', authMiddleware, (req, res) => {
  const enrollments = db.getEnrollmentsByUser(req.user.id)
  const courses = enrollments.map(e => {
    const c = db.getCourseById(e.course_id)
    if (!c) return null
    const chapters = db.getChaptersByCourse(c.id)
    const progress = db.getProgressByCourse(req.user.id, c.id)
    const completed = progress.filter(p => p.completed).length
    return { ...c, enrolled_at: e.enrolled_at, total_chapters: chapters.length, completed_chapters: completed }
  }).filter(Boolean).reverse()
  res.json(courses)
})

router.post('/progress', authMiddleware, (req, res) => {
  const { chapter_id, completed, watched_sec } = req.body
  const chapter = db.getChapterById(parseInt(chapter_id))
  if (!chapter) return res.status(404).json({ error: '챕터 없음' })
  if (!db.isEnrolled(req.user.id, chapter.course_id)) return res.status(403).json({ error: '수강 신청 필요' })
  db.upsertProgress(req.user.id, chapter_id, completed, watched_sec || 0)
  res.json({ success: true })
})

router.post('/reviews', authMiddleware, (req, res) => {
  const { course_id, rating, content } = req.body
  if (!course_id || !rating) return res.status(400).json({ error: '필수 항목 누락' })
  if (!db.isEnrolled(req.user.id, parseInt(course_id))) return res.status(403).json({ error: '수강생만 후기를 작성할 수 있습니다.' })
  db.upsertReview(req.user.id, parseInt(course_id), rating, content)
  res.json({ success: true })
})

// 내 쿠폰 조회
router.get('/coupons', authMiddleware, (req, res) => {
  const coupons = db.getCouponsByUser(req.user.id)
  res.json(coupons)
})

// 마케팅 동의 철회
router.delete('/marketing-consent', authMiddleware, (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress
  db.revokeMarketing(req.user.id, ip)
  res.json({ success: true })
})

module.exports = router
