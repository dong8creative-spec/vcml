const express = require('express')
const router = express.Router()
const db = require('../db/schema')
const { authMiddleware: auth } = require('../middleware/auth')

// GET /api/messages/:projectId — 메시지 목록
router.get('/:projectId', auth, async (req, res) => {
  try {
    const { projectId } = req.params
    const { since } = req.query
    const project = await db.getProjectById(projectId)
    if (!project) return res.status(404).json({ error: '의뢰를 찾을 수 없습니다.' })

    // 접근 권한: 의뢰인이거나 수락된 편집자
    const isClient = project.client_id === req.user.id
    const isMatchedEditor = project.matched_editor_id === req.user.id || req.user.role === 'admin'
    if (!isClient && !isMatchedEditor) return res.status(403).json({ error: '접근 권한이 없습니다.' })

    const messages = await db.getMessages(projectId, since || null)
    await db.markMessagesRead(projectId, req.user.id)
    res.json(messages)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/messages/:projectId — 메시지 전송
router.post('/:projectId', auth, async (req, res) => {
  try {
    const { projectId } = req.params
    const { content } = req.body
    if (!content || !content.trim()) return res.status(400).json({ error: '메시지 내용을 입력해주세요.' })

    const project = await db.getProjectById(projectId)
    if (!project) return res.status(404).json({ error: '의뢰를 찾을 수 없습니다.' })

    const isClient = project.client_id === req.user.id
    const isMatchedEditor = project.matched_editor_id === req.user.id || req.user.role === 'admin'
    if (!isClient && !isMatchedEditor) return res.status(403).json({ error: '접근 권한이 없습니다.' })

    const msg = await db.sendMessage(projectId, req.user.id, req.user.name, req.user.role, content.trim())
    res.json(msg)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/messages/:projectId/unread — 안읽은 메시지 수
router.get('/:projectId/unread', auth, async (req, res) => {
  try {
    const count = await db.getUnreadCount(req.params.projectId, req.user.id)
    res.json({ count })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
