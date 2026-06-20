const jwt = require('jsonwebtoken')

function authMiddleware(req, res, next) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: '로그인이 필요합니다.' })
  }
  try {
    const token = header.slice(7)
    req.user = jwt.verify(token, process.env.JWT_SECRET)
    next()
  } catch (e) {
    console.error('JWT 검증 오류:', e.message)
    res.status(401).json({ error: '세션이 만료되었습니다.' })
  }
}

function adminMiddleware(req, res, next) {
  authMiddleware(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: '권한이 없습니다.' })
    next()
  })
}

/** 로그인 선택 — 토큰 없거나 만료여도 통과 */
function optionalAuth(req, res, next) {
  const header = req.headers.authorization
  if (header && header.startsWith('Bearer ')) {
    try {
      req.user = jwt.verify(header.slice(7), process.env.JWT_SECRET)
    } catch {}
  }
  next()
}

function allowedReviewTypes(viewer) {
  const types = ['student']
  if (!viewer) return types
  if (viewer.member_type === 'client' || viewer.role === 'admin') types.push('client')
  if (viewer.role === 'editor' || viewer.role === 'admin') types.push('editor')
  return types
}

module.exports = { authMiddleware, adminMiddleware, optionalAuth, allowedReviewTypes }
