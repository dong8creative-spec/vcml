const router = require('express').Router()
const db = require('../db/schema')

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

module.exports = router
