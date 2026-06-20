const router = require('express').Router()
const db = require('../db/schema')
const { EDITOR_WORK_TYPES, getTotalMailCountFromConfig } = require('../db/schema')
const { authMiddleware } = require('../middleware/auth')

const WORK_TYPE_LABELS = {
  remote: '원격·재택',
  hybrid: '하이브리드',
  onsite: '현장 근무',
  project: '프로젝트 단위',
  fulltime: '풀타임·장기',
}

function editorProfileView(app, user) {
  if (!app) return null
  const ts = Date.now()
  const featuredActive = app.featured_until && new Date(app.featured_until).getTime() > ts
  return {
    ...app,
    name: user?.name,
    email: user?.email,
    work_type_label: WORK_TYPE_LABELS[app.work_type] || app.work_type || null,
    is_featured: featuredActive,
    work_type_options: EDITOR_WORK_TYPES.map(v => ({ value: v, label: WORK_TYPE_LABELS[v] })),
  }
}

// 편집자 신청
router.post('/apply', authMiddleware, async (req, res) => {
  const { intro, skills, portfolio_url, experience_years, tools, location, work_type } = req.body
  const progress = await db.getEditorWorkbookProgress(req.user.id)
  if (!progress.can_apply) {
    return res.status(403).json({
      error: `에디터즈 신청을 위해 워크북 ${progress.required}단계를 모두 완료해야 합니다. (현재 ${progress.passed}/${progress.required}단계)`,
      workbook_progress: progress,
    })
  }
  if (!intro || !skills) return res.status(400).json({ error: '자기소개와 보유 스킬은 필수입니다.' })
  if (!location) return res.status(400).json({ error: '활동 지역을 선택해주세요.' })
  if (!work_type || !EDITOR_WORK_TYPES.includes(work_type)) {
    return res.status(400).json({ error: '희망 근무 형태를 선택해주세요.' })
  }
  const existing = await db.getEditorApplication(req.user.id)
  if (existing && existing.status === 'approved') return res.status(409).json({ error: '이미 승인된 에디터즈입니다.' })
  if (existing && existing.status === 'pending') return res.status(409).json({ error: '심사 중인 신청이 있습니다. 결과를 기다려주세요.' })
  const app = await db.applyEditor(req.user.id, {
    intro, skills, portfolio_url, experience_years, tools, location, work_type,
  })
  res.json({ success: true, application: app })
})

// 에디터즈 프로그램 — 동의 · 타이머
router.get('/program', authMiddleware, async (req, res) => {
  const progress = await db.getEditorWorkbookProgress(req.user.id)
  res.json(progress)
})

router.post('/program/agree', authMiddleware, async (req, res) => {
  const existing = await db.getEditorApplication(req.user.id)
  if (existing?.status === 'approved') {
    return res.status(409).json({ error: '이미 승인된 에디터즈입니다.' })
  }
  const result = await db.agreeEditorProgram(req.user.id, {
    guide_steps_completed: parseInt(req.body.guide_steps_completed, 10) || 0,
  })
  if (result?.error === 'guide_incomplete') {
    return res.status(400).json({ error: result.message })
  }
  const progress = await db.getEditorWorkbookProgress(req.user.id)
  res.json({ success: true, progress })
})

router.get('/program/guide', async (req, res) => {
  const config = await db.getEditorProgramConfig()
  res.json({
    terms_version: config.terms_version,
    guide_cards: config.guide_cards,
    stage_count: config.stage_count,
    stages: config.stages.map(s => ({ order: s.order, title: s.title, mail_count: s.mail_count, minutes: s.minutes })),
    total_mails: getTotalMailCountFromConfig(config),
  })
})

// 에디터즈 워크북 — 의뢰 메일 미션
router.get('/workbooks/eligibility', authMiddleware, async (req, res) => {
  res.json(await db.getEditorWorkbookProgress(req.user.id))
})

router.get('/workbooks', authMiddleware, async (req, res) => {
  res.json(await db.getEditorWorkbookProgress(req.user.id))
})

router.post('/workbooks/:id/begin', authMiddleware, async (req, res) => {
  const result = await db.beginWorkbookStage(req.user.id, req.params.id)
  if (result.error === 'timeout_reset') return res.status(403).json({ error: result.message, timed_out: true })
  if (result.error === 'not_agreed') return res.status(403).json({ error: result.message, needs_agreement: true })
  if (result.error === 'not_active_stage') return res.status(403).json({ error: result.message })
  if (result.error === 'not_found') return res.status(404).json({ error: '의뢰 메일을 찾을 수 없습니다.' })
  res.json({ success: true, ...result })
})

router.get('/workbooks/:id', authMiddleware, async (req, res) => {
  const begin = await db.beginWorkbookStage(req.user.id, req.params.id)
  if (begin.error === 'timeout_reset') {
    return res.status(403).json({ error: begin.message, timed_out: true })
  }
  if (begin.error === 'not_agreed') {
    return res.status(403).json({ error: begin.message, needs_agreement: true })
  }
  if (begin.error === 'not_active_stage') {
    return res.status(403).json({ error: begin.message })
  }
  if (begin.error === 'not_found') return res.status(404).json({ error: '의뢰 메일을 찾을 수 없습니다.' })
  const workbook = await db.getEditorWorkbookById(req.params.id)
  const progress = await db.getEditorWorkbookProgress(req.user.id)
  const item = progress.workbooks.find(w => w.id === req.params.id)
  const { body, min_note_length, required_keywords, pass_message, ...preview } = workbook
  res.json({
    ...preview,
    body,
    min_note_length,
    required_keywords,
    pass_message,
    status: item?.status || 'locked',
    can_submit: item?.can_submit ?? false,
    locked_until: item?.locked_until,
    submission: item?.submission,
    view_only: !!begin.view_only,
    stage: begin,
    progress: {
      passed: progress.passed,
      required: progress.required,
      can_apply: progress.can_apply,
      program: progress.program,
    },
  })
})

router.post('/workbooks/:id/submit', authMiddleware, async (req, res) => {
  const { deliverable_url, work_notes } = req.body
  const result = await db.submitEditorWorkbook(req.user.id, req.params.id, { deliverable_url, work_notes })
  if (result.error === 'timeout_reset') {
    return res.status(403).json({ error: result.message, timed_out: true })
  }
  if (result.error === 'not_agreed') {
    return res.status(403).json({ error: result.message, needs_agreement: true })
  }
  if (result.error === 'not_found') return res.status(404).json({ error: '의뢰 메일을 찾을 수 없습니다.' })
  if (result.error === 'not_active_stage') return res.status(403).json({ error: result.message })
  if (result.error === 'already_passed') return res.status(409).json({ error: result.message })
  const progress = await db.getEditorWorkbookProgress(req.user.id)
  res.json({
    success: true,
    passed: result.passed,
    feedback: result.feedback,
    locked_until: result.locked_until || null,
    progress,
  })
})

// 에디터즈 신청 페이지 설정 (공개)
router.get('/apply-settings', async (req, res) => {
  const settings = await db.getSiteSettings('editor_apply')
  res.json({ pending_review_image: settings.pending_review_image || null })
})

// 내 신청 상태 조회
router.get('/my-application', authMiddleware, async (req, res) => {
  const app = await db.getEditorApplication(req.user.id)
  if (!app) return res.json(null)
  const user = await db.findUserById(req.user.id)
  res.json(editorProfileView(app, user))
})

// 승인된 편집자 — 프로필 수정
router.patch('/profile', authMiddleware, async (req, res) => {
  const user = await db.findUserById(req.user.id)
  if (!user || user.role !== 'editor') {
    return res.status(403).json({ error: '승인된 에디터즈만 수정할 수 있습니다.' })
  }
  const { location, work_type, intro, portfolio_url } = req.body
  if (work_type !== undefined && work_type && !EDITOR_WORK_TYPES.includes(work_type)) {
    return res.status(400).json({ error: '올바른 근무 형태를 선택해주세요.' })
  }
  const app = await db.updateEditorProfile(req.user.id, { location, work_type, intro, portfolio_url })
  if (!app) return res.status(404).json({ error: '에디터즈 프로필을 찾을 수 없습니다.' })
  res.json({ success: true, profile: editorProfileView(app, user) })
})

// 상위노출 쿠폰 사용 (미사용 쿠폰이 있을 때)
router.post('/featured-coupon', authMiddleware, async (req, res) => {
  const { coupon_id } = req.body
  if (!coupon_id) return res.status(400).json({ error: '쿠폰 ID가 필요합니다.' })
  const result = await db.redeemEditorFeaturedCoupon(req.user.id, coupon_id)
  if (!result) return res.status(400).json({ error: '사용할 수 없는 쿠폰입니다.' })
  res.json({ success: true, ...result })
})

// 승인된 편집자 목록 (공개)
router.get('/list', async (req, res) => {
  const editors = await db.getApprovedEditors()
  res.json(editors.map(e => ({
    ...e,
    work_type_label: WORK_TYPE_LABELS[e.work_type] || e.work_type || null,
  })))
})

// 편집자 프로필 (공개)
router.get('/profile/:userId', async (req, res) => {
  const profile = await db.getEditorProfile(req.params.userId)
  if (!profile) return res.status(404).json({ error: '에디터를 찾을 수 없습니다.' })
  const { password, ...safe } = profile
  safe.work_type_label = WORK_TYPE_LABELS[safe.work_type] || safe.work_type || null
  safe.is_featured = safe.featured_until && new Date(safe.featured_until).getTime() > Date.now()
  res.json(safe)
})

module.exports = router
