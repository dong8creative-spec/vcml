const router = require('express').Router()
const db = require('../db/schema')
const { authMiddleware } = require('../middleware/auth')

// 편집자 신청
router.post('/apply', authMiddleware, async (req, res) => {
  const { intro, skills, portfolio_url, experience_years, tools } = req.body
  if (!intro || !skills) return res.status(400).json({ error: '자기소개와 보유 스킬은 필수입니다.' })
  const existing = await db.getEditorApplication(req.user.id)
  if (existing && existing.status === 'approved') return res.status(409).json({ error: '이미 승인된 편집자입니다.' })
  if (existing && existing.status === 'pending') return res.status(409).json({ error: '심사 중인 신청이 있습니다. 결과를 기다려주세요.' })
  const app = await db.applyEditor(req.user.id, { intro, skills, portfolio_url, experience_years, tools })
  res.json({ success: true, application: app })
})

// 내 신청 상태 조회
router.get('/my-application', authMiddleware, async (req, res) => {
  const app = await db.getEditorApplication(req.user.id)
  res.json(app || null)
})

// 승인된 편집자 목록 (공개)
router.get('/list', async (req, res) => {
  const editors = await db.getApprovedEditors()
  res.json(editors)
})

// 편집자 프로필 (공개)
router.get('/profile/:userId', async (req, res) => {
  const profile = await db.getEditorProfile(req.params.userId)
  if (!profile) return res.status(404).json({ error: '편집자를 찾을 수 없습니다.' })
  const { password, ...safe } = profile
  res.json(safe)
})

module.exports = router
