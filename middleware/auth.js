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

module.exports = { authMiddleware, adminMiddleware }
