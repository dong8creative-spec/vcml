const router = require('express').Router()
const db = require('../db/schema')
const { authMiddleware } = require('../middleware/auth')

// 의뢰 목록 (편집자/누구나 열람)
router.get('/', async (req, res) => {
  const { status, category } = req.query
  let projects = await db.getProjects(status || 'open')
  if (category) projects = projects.filter(p => p.category === category)
  // 클라이언트 이름 붙이기
  const result = await Promise.all(projects.map(async p => {
    const client = await db.findUserById(p.client_id)
    const quotes = await db.getQuotesByProject(p.id)
    return { ...p, client_name: client?.name || '익명', quote_count: quotes.length }
  }))
  res.json(result)
})

// 의뢰 상세
router.get('/:id', async (req, res) => {
  const project = await db.getProjectById(req.params.id)
  if (!project) return res.status(404).json({ error: '의뢰를 찾을 수 없습니다.' })
  const client = await db.findUserById(project.client_id)
  const quotes = await db.getQuotesByProject(project.id)
  // 견적에 편집자 정보 붙이기
  const quotesWithEditor = await Promise.all(quotes.map(async q => {
    const editor = await db.findUserById(q.editor_id)
    return { ...q, editor_name: editor?.name || '-' }
  }))
  res.json({ ...project, client_name: client?.name || '익명', quotes: quotesWithEditor })
})

// 의뢰 등록 (로그인 필요)
router.post('/', authMiddleware, async (req, res) => {
  const { title, description, category, budget_min, budget_max, deadline, requirements } = req.body
  if (!title || !description || !category) return res.status(400).json({ error: '제목, 설명, 카테고리는 필수입니다.' })
  const project = await db.createProject(req.user.id, { title, description, category, budget_min, budget_max, deadline, requirements })
  res.json({ success: true, project })
})

// 내 의뢰 목록
router.get('/my/list', authMiddleware, async (req, res) => {
  const projects = await db.getProjectsByClient(req.user.id)
  const result = await Promise.all(projects.map(async p => {
    const quotes = await db.getQuotesByProject(p.id)
    return { ...p, quote_count: quotes.length }
  }))
  res.json(result)
})

// 견적 제출 (편집자만)
router.post('/:id/quotes', authMiddleware, async (req, res) => {
  const user = await db.findUserById(req.user.id)
  if (user?.role !== 'editor') return res.status(403).json({ error: '승인된 편집자만 견적을 제출할 수 있습니다.' })
  const project = await db.getProjectById(req.params.id)
  if (!project) return res.status(404).json({ error: '의뢰를 찾을 수 없습니다.' })
  if (project.status !== 'open') return res.status(400).json({ error: '이미 마감된 의뢰입니다.' })
  if (project.client_id === req.user.id) return res.status(400).json({ error: '본인 의뢰에는 견적을 제출할 수 없습니다.' })
  const { amount, message } = req.body
  if (!amount || !message) return res.status(400).json({ error: '금액과 메시지는 필수입니다.' })
  try {
    const quote = await db.submitQuote(req.user.id, req.params.id, { amount, message })
    res.json({ success: true, quote })
  } catch (e) {
    res.status(409).json({ error: e.message })
  }
})

// 내 견적 목록 (편집자)
router.get('/my/quotes', authMiddleware, async (req, res) => {
  const quotes = await db.getQuotesByEditor(req.user.id)
  const result = await Promise.all(quotes.map(async q => {
    const p = await db.getProjectById(q.project_id)
    return { ...q, project_title: p?.title, project_status: p?.status, project_category: p?.category }
  }))
  res.json(result)
})

// 견적 수락 (의뢰인만)
router.post('/:id/quotes/:quoteId/accept', authMiddleware, async (req, res) => {
  const project = await db.getProjectById(req.params.id)
  if (!project) return res.status(404).json({ error: '의뢰를 찾을 수 없습니다.' })
  if (project.client_id !== req.user.id) return res.status(403).json({ error: '의뢰인만 견적을 수락할 수 있습니다.' })
  if (project.status !== 'open') return res.status(400).json({ error: '이미 처리된 의뢰입니다.' })
  await db.acceptQuote(req.params.quoteId, req.params.id)
  res.json({ success: true })
})

// 의뢰 상태 변경 (의뢰인)
router.patch('/:id/status', authMiddleware, async (req, res) => {
  const project = await db.getProjectById(req.params.id)
  if (!project) return res.status(404).json({ error: '의뢰를 찾을 수 없습니다.' })
  if (project.client_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: '권한이 없습니다.' })
  const { status } = req.body
  await db.updateProject(req.params.id, { status })
  res.json({ success: true })
})

module.exports = router
