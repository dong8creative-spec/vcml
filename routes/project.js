const router = require('express').Router()
const db = require('../db/schema')
const { authMiddleware } = require('../middleware/auth')

// 의뢰 목록
router.get('/', async (req, res) => {
  try {
    const { status, category } = req.query
    let projects = await db.getProjects(status || 'open')
    if (category) projects = projects.filter(p => p.category === category)
    const result = await Promise.all(projects.map(async p => {
      const client = await db.findUserById(p.client_id)
      const quotes = await db.getQuotesByProject(p.id)
      return { ...p, client_name: client?.name || '익명', quote_count: quotes.length }
    }))
    res.json(result)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// 내 의뢰 목록 (의뢰인)
router.get('/my/list', authMiddleware, async (req, res) => {
  try {
    const projects = await db.getProjectsByClient(req.user.id)
    const result = await Promise.all(projects.map(async p => {
      const quotes = await db.getQuotesByProject(p.id)
      return { ...p, quote_count: quotes.length }
    }))
    res.json(result)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// 내 견적 목록 (편집자)
router.get('/my/quotes', authMiddleware, async (req, res) => {
  try {
    const quotes = await db.getQuotesByEditor(req.user.id)
    const result = await Promise.all(quotes.map(async q => {
      const p = await db.getProjectById(q.project_id)
      return { ...q, project_title: p?.title, project_status: p?.status, project_category: p?.category, client_id: p?.client_id }
    }))
    res.json(result)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// 의뢰 상세
router.get('/:id', async (req, res) => {
  try {
    const project = await db.getProjectById(req.params.id)
    if (!project) return res.status(404).json({ error: '의뢰를 찾을 수 없습니다.' })
    const client = await db.findUserById(project.client_id)
    const quotes = await db.getQuotesByProject(project.id)
    const quotesWithEditor = await Promise.all(quotes.map(async q => {
      const editor = await db.findUserById(q.editor_id)
      return { ...q, editor_name: editor?.name || '-' }
    }))
    // 매칭된 편집자 정보
    let matched_editor_name = null
    if (project.matched_editor_id) {
      const me = await db.findUserById(project.matched_editor_id)
      matched_editor_name = me?.name || null
    }
    res.json({ ...project, client_name: client?.name || '익명', quotes: quotesWithEditor, matched_editor_name })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// 의뢰 등록
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { title, description, category, budget_min, budget_max, deadline, requirements } = req.body
    if (!title || !description || !category) return res.status(400).json({ error: '제목, 설명, 카테고리는 필수입니다.' })
    const project = await db.createProject(req.user.id, { title, description, category, budget_min, budget_max, deadline, requirements })
    res.json({ success: true, project })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// 견적 제출 (편집자만)
router.post('/:id/quotes', authMiddleware, async (req, res) => {
  try {
    const user = await db.findUserById(req.user.id)
    if (user?.role !== 'editor') return res.status(403).json({ error: '승인된 편집자만 견적을 제출할 수 있습니다.' })
    const project = await db.getProjectById(req.params.id)
    if (!project) return res.status(404).json({ error: '의뢰를 찾을 수 없습니다.' })
    if (project.status !== 'open') return res.status(400).json({ error: '이미 마감된 의뢰입니다.' })
    if (project.client_id === req.user.id) return res.status(400).json({ error: '본인 의뢰에는 견적을 제출할 수 없습니다.' })
    const { amount, message } = req.body
    if (!amount || !message) return res.status(400).json({ error: '금액과 메시지는 필수입니다.' })
    const quote = await db.submitQuote(req.user.id, req.params.id, { amount, message })
    res.json({ success: true, quote })
  } catch (e) { res.status(409).json({ error: e.message }) }
})

// 견적 수락 (의뢰인만)
router.post('/:id/quotes/:quoteId/accept', authMiddleware, async (req, res) => {
  try {
    const project = await db.getProjectById(req.params.id)
    if (!project) return res.status(404).json({ error: '의뢰를 찾을 수 없습니다.' })
    if (project.client_id !== req.user.id) return res.status(403).json({ error: '의뢰인만 견적을 수락할 수 있습니다.' })
    if (project.status !== 'open') return res.status(400).json({ error: '이미 처리된 의뢰입니다.' })
    const quote = await db.getQuotesByProject(req.params.id).then(qs => qs.find(q => q.id === req.params.quoteId))
    if (!quote) return res.status(404).json({ error: '견적을 찾을 수 없습니다.' })
    await db.acceptQuote(req.params.quoteId, req.params.id)
    // matched_editor_id 저장
    await db.updateProject(req.params.id, { matched_editor_id: quote.editor_id })
    res.json({ success: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// 진행 단계 업데이트 (편집자: contract→working→delivered, 의뢰인: delivered→completed)
router.patch('/:id/stage', authMiddleware, async (req, res) => {
  try {
    const project = await db.getProjectById(req.params.id)
    if (!project) return res.status(404).json({ error: '의뢰를 찾을 수 없습니다.' })
    const { stage } = req.body
    const isClient = project.client_id === req.user.id
    const isMatchedEditor = project.matched_editor_id === req.user.id

    // 권한 체크
    if (stage === 'completed' && !isClient) return res.status(403).json({ error: '의뢰인만 완료 처리할 수 있습니다.' })
    if (['contract', 'in_progress', 'delivered'].includes(stage) && !isMatchedEditor && req.user.role !== 'admin') return res.status(403).json({ error: '편집자만 상태를 변경할 수 있습니다.' })

    await db.updateProjectStage(req.params.id, stage)
    res.json({ success: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// 의뢰 상태 변경 (의뢰인/admin)
router.patch('/:id/status', authMiddleware, async (req, res) => {
  try {
    const project = await db.getProjectById(req.params.id)
    if (!project) return res.status(404).json({ error: '의뢰를 찾을 수 없습니다.' })
    if (project.client_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: '권한이 없습니다.' })
    await db.updateProject(req.params.id, { status: req.body.status })
    res.json({ success: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

module.exports = router
