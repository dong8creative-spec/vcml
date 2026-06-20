const router = require('express').Router()
const db = require('../db/schema')
const userPayload = require('../db/schema').userPayload
const { authMiddleware } = require('../middleware/auth')

const MAX_BIO = 500
const MAX_IMAGE_LEN = 480000
const MAX_LINKS = 5

function profileView(user) {
  if (!user) return null
  return {
    ...userPayload(user),
    marketing_agreed: !!user.marketing_agreed,
    phone: user.phone || null,
  }
}

function isValidImage(value) {
  if (!value) return true
  if (typeof value !== 'string') return false
  if (value.length > MAX_IMAGE_LEN) return false
  return /^https?:\/\/.+/i.test(value) || /^data:image\/(jpeg|jpg|png|webp);base64,/.test(value)
}

function normalizeSocialLinks(links) {
  if (!Array.isArray(links)) return []
  return links
    .slice(0, MAX_LINKS)
    .map(l => ({
      label: String(l?.label || '').trim().slice(0, 30),
      url: String(l?.url || '').trim(),
    }))
    .filter(l => l.url && /^https?:\/\/.+/i.test(l.url))
}

router.get('/profile', authMiddleware, async (req, res) => {
  const user = await db.findUserById(req.user.id)
  if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' })
  res.json(profileView(user))
})

router.patch('/profile', authMiddleware, async (req, res) => {
  const { name, bio, profile_image, social_links } = req.body
  const trimmedName = name !== undefined ? String(name).trim() : undefined
  if (trimmedName !== undefined && (trimmedName.length < 2 || trimmedName.length > 30)) {
    return res.status(400).json({ error: '이름은 2~30자로 입력해주세요.' })
  }
  if (bio !== undefined && String(bio).length > MAX_BIO) {
    return res.status(400).json({ error: `자기소개는 ${MAX_BIO}자 이내로 입력해주세요.` })
  }
  if (profile_image !== undefined && profile_image !== null && !isValidImage(profile_image)) {
    return res.status(400).json({ error: '프로필 사진은 JPG/PNG/WEBP 이미지 또는 http(s) URL만 사용할 수 있습니다.' })
  }
  const links = social_links !== undefined ? normalizeSocialLinks(social_links) : undefined

  const user = await db.updateUserProfile(req.user.id, {
    name: trimmedName,
    bio: bio !== undefined ? String(bio).trim() : undefined,
    profile_image: profile_image === undefined ? undefined : (profile_image || null),
    social_links: links,
  })
  res.json({ success: true, user: profileView(user) })
})

router.get('/courses', authMiddleware, async (req, res) => {
  const enrollments = await db.getEnrollmentsByUser(req.user.id)
  const courses = await Promise.all(enrollments.map(async e => {
    const c = await db.getCourseById(e.course_id)
    if (!c) return null
    const chapters = await db.getChaptersByCourse(c.id)
    const progress = await db.getProgressByCourse(req.user.id, c.id)
    const completed = progress.filter(p => p.completed).length
    return { ...c, enrolled_at: e.enrolled_at, total_chapters: chapters.length, completed_chapters: completed, last_chapter_id: e.last_chapter_id || null }
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
