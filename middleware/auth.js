const jwt = require('jsonwebtoken')
const { isAllowedAdmin } = require('../utils/adminAccess')

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for']
  if (fwd) return String(fwd).split(',')[0].trim()
  return req.ip || req.socket?.remoteAddress || ''
}

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
  authMiddleware(req, res, async () => {
    try {
      const db = require('../db/schema')
      const user = await db.findUserById(req.user.id)
      if (!isAllowedAdmin(user)) {
        return res.status(403).json({ error: '관리자 접근 권한이 없습니다.' })
      }
      next()
    } catch (e) {
      console.error('adminMiddleware:', e.message)
      res.status(500).json({ error: '관리자 권한 확인 중 오류가 발생했습니다.' })
    }
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

/** 타닥싱크 앱 전용 — JWT + 계정당 1기기 세션 검증 */
function subtitleAppAuth(req, res, next) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: '로그인이 필요합니다.', code: 'auth_required' })
  }
  let user
  try {
    user = jwt.verify(header.slice(7), process.env.JWT_SECRET)
  } catch (e) {
    console.error('JWT 검증 오류:', e.message)
    return res.status(401).json({ error: '세션이 만료되었습니다.', code: 'token_expired' })
  }
  req.user = user
  if (!user?.subtitle) {
    return res.status(401).json({
      error: '앱 기기 연동이 필요합니다. 프로그램에서 다시 로그인해 주세요.',
      code: 'subtitle_login_required',
    })
  }
  const deviceId = String(req.headers['x-subtitle-device-id'] || '').trim()
  if (!deviceId) {
    return res.status(401).json({
      error: '기기 정보가 없습니다. 프로그램을 다시 실행해 주세요.',
      code: 'device_required',
    })
  }
  const db = require('../db/schema')
  db.assertSubtitleDeviceSession(user.id, {
    deviceId,
    sessionId: user.session_id,
    ip: clientIp(req),
  }).then((session) => {
    if (!session.ok) {
      return res.status(401).json({ error: session.error, code: session.code })
    }
    next()
  }).catch((e) => {
    console.error('subtitleAppAuth:', e)
    res.status(500).json({ error: '기기 연동을 확인하지 못했습니다.' })
  })
}

module.exports = { authMiddleware, adminMiddleware, optionalAuth, allowedReviewTypes, subtitleAppAuth, clientIp }
