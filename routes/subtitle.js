const express = require('express')
const jwt = require('jsonwebtoken')
const db = require('../db/schema')
const { authMiddleware, subtitleAppAuth, clientIp } = require('../middleware/auth')
const { recordLoginLog } = require('../utils/loginAudit')
const { getSignedDownloadUrl } = require('../utils/storage')

const router = express.Router()

const SUBTITLE_AUTO_FREE_SETUP_PATH = process.env.SUBTITLE_AUTO_FREE_SETUP_PATH
  || 'subtitle-tool/TadakSync-Auto-Free-Setup.exe'
const FREE_URL_TTL_MS = 15 * 60 * 1000
const FREE_URL_CACHE_MS = 12 * 60 * 1000
let freeDownloadUrlCache = null
let freeDownloadUrlRequest = null

async function getFreeInstallerUrl() {
  if (freeDownloadUrlCache && freeDownloadUrlCache.cacheUntil > Date.now()) {
    return freeDownloadUrlCache
  }
  if (!freeDownloadUrlRequest) {
    const requestedAt = Date.now()
    freeDownloadUrlRequest = getSignedDownloadUrl(SUBTITLE_AUTO_FREE_SETUP_PATH, FREE_URL_TTL_MS)
      .then(url => {
        freeDownloadUrlCache = {
          url,
          signedExpiresAt: requestedAt + FREE_URL_TTL_MS,
          cacheUntil: Math.min(requestedAt + FREE_URL_CACHE_MS, requestedAt + FREE_URL_TTL_MS - 60_000),
        }
        return freeDownloadUrlCache
      })
      .finally(() => { freeDownloadUrlRequest = null })
  }
  return freeDownloadUrlRequest
}
const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://vcml.kr'

function signSubtitleToken(user, deviceId, sessionId) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      member_type: user.member_type || 'student',
      subtitle: true,
      device_id: deviceId,
      session_id: sessionId,
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' },
  )
}

/** GET /api/subtitle/entitlement — 구글 로그인 확인 */
router.get('/entitlement', authMiddleware, async (req, res) => {
  try {
    const result = await db.ensureSubtitleEntitlement(req.user.id)
    if (!result.ok) {
      return res.status(403).json(result)
    }
    res.json(result)
  } catch (e) {
    console.error('subtitle entitlement:', e)
    res.status(500).json({ error: '이용 권한을 확인하지 못했습니다.' })
  }
})

/** GET /api/subtitle/me — 앱이 로그인 직후·주기적으로 계정 상태를 재확인 (앱 전용) */
router.get('/me', subtitleAppAuth, async (req, res) => {
  try {
    const result = await db.ensureSubtitleEntitlement(req.user.id)
    if (!result.ok) {
      return res.status(403).json(result)
    }
    const user = await db.findUserById(req.user.id)
    const refreshedToken = signSubtitleToken(user || req.user, req.user.device_id, req.user.session_id)
    const pendingActions = await db.listSubtitleAppInbox(req.user.id)
    res.json({
      email: req.user.email || null,
      name: req.user.name || null,
      token: refreshedToken,
      has_google: !!result.has_google,
      pending_actions: pendingActions,
    })
  } catch (e) {
    console.error('subtitle me:', e)
    res.status(500).json({ error: '계정 정보를 불러오지 못했습니다.' })
  }
})

/** GET /api/subtitle/history — 사용 내역 (앱 전용, 코인 폐지로 항상 빈 목록) */
router.get('/history', subtitleAppAuth, async (req, res) => {
  try {
    const result = await db.ensureSubtitleEntitlement(req.user.id)
    if (!result.ok) {
      return res.status(403).json(result)
    }
    res.json({ history: [] })
  } catch (e) {
    console.error('subtitle history:', e)
    res.status(500).json({ error: '사용 내역을 불러오지 못했습니다.' })
  }
})

/** POST /api/subtitle/smartstore-review/claim — 코인 폐지로 더 이상 제공되지 않는 혜택 (앱 전용) */
router.post('/smartstore-review/claim', subtitleAppAuth, async (req, res) => {
  res.status(410).json({ ok: false, code: 'discontinued', error: '이 혜택은 더 이상 제공되지 않습니다.' })
})

/** POST /api/subtitle/inbox/ack — 앱 안내 메시지 확인 처리 (앱 전용) */
router.post('/inbox/ack', subtitleAppAuth, async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.message_ids) ? req.body.message_ids : []
    res.json(await db.ackSubtitleAppInbox(req.user.id, ids))
  } catch (e) {
    console.error('subtitle inbox ack:', e)
    res.status(500).json({ error: '알림 확인 처리에 실패했습니다.' })
  }
})

/** GET /api/subtitle/download-free — 회원용 TADAKSYNC AUTO FREE 설치파일 */
router.get('/download-free', authMiddleware, async (req, res) => {
  try {
    const user = await db.findUserById(req.user.id)
    if (!user) {
      return res.status(403).json({ ok: false, code: 'not_found', error: '사용자를 찾을 수 없습니다.' })
    }
    if (!user.google_id) {
      return res.status(403).json({ ok: false, code: 'google_required', error: '타닥싱크는 구글 로그인 계정만 이용할 수 있습니다.' })
    }
    const signed = await getFreeInstallerUrl()
    res.set('Cache-Control', 'private, no-store')
    res.json({
      url: signed.url,
      filename: 'TadakSync-Auto-Free-Setup.exe',
      os: 'win',
      expires_in: Math.max(0, Math.floor((signed.signedExpiresAt - Date.now()) / 1000)),
    })
  } catch (e) {
    console.error('subtitle auto-free download:', e)
    const missing = /찾을 수 없습니다/.test(e.message || '')
    res.status(missing ? 404 : 500).json({
      error: missing
        ? '무료 버전 설치파일이 아직 준비되지 않았습니다. 잠시 후 다시 시도해주세요.'
        : '무료 버전 다운로드 링크를 만들지 못했습니다.',
    })
  }
})

/** POST /api/subtitle/device/start — 앱이 연동 코드 발급 (인증 불필요) */
router.post('/device/start', async (req, res) => {
  try {
    const deviceId = String(req.body?.device_id || '').trim().slice(0, 64)
    if (!deviceId) {
      return res.status(400).json({ error: '기기 정보가 필요합니다.', code: 'device_required' })
    }
    const { code, expires_at } = await db.createSubtitleDeviceCode(deviceId)
    res.json({
      code,
      expires_at,
      verify_url: `${SITE_ORIGIN}/mypage.html?tab=tadaksync&code=${encodeURIComponent(code)}`,
    })
  } catch (e) {
    console.error('subtitle device start:', e)
    res.status(500).json({ error: '연동 코드를 발급하지 못했습니다.' })
  }
})

/** POST /api/subtitle/device/approve — 웹에서 코드 승인 */
router.post('/device/approve', authMiddleware, async (req, res) => {
  try {
    const code = String(req.body?.code || '').trim()
    if (!code) return res.status(400).json({ error: '연동 코드가 필요합니다.' })

    const entitlement = await db.ensureSubtitleEntitlement(req.user.id)
    if (!entitlement.ok) {
      return res.status(403).json(entitlement)
    }

    const user = await db.findUserById(req.user.id)
    if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' })

    const codeRow = await db.getSubtitleDeviceCode(code)
    if (!codeRow) {
      return res.status(400).json({ ok: false, code: 'invalid_code', error: '연동 코드를 찾을 수 없습니다.' })
    }
    const deviceId = codeRow.device_id
    if (!deviceId) {
      return res.status(400).json({
        ok: false,
        code: 'device_required',
        error: '기기 정보가 없는 연동 코드입니다. 앱을 최신 버전으로 업데이트한 뒤 다시 시도해 주세요.',
      })
    }

    const bound = await db.bindSubtitleDeviceSession(req.user.id, deviceId, clientIp(req))
    if (!bound.ok) {
      return res.status(400).json(bound)
    }

    const token = signSubtitleToken(user, deviceId, bound.session_id)
    const approved = await db.approveSubtitleDeviceCode(code, user.id, token, user.name)
    if (!approved.ok) {
      const status = approved.code === 'expired' || approved.code === 'invalid_code' ? 400 : 409
      return res.status(status).json(approved)
    }
    await recordLoginLog(req, {
      user_id: user.id,
      email: user.email,
      user_name: user.name,
      method: 'subtitle_app',
      success: true,
      client: 'subtitle_app',
    })
    res.json({
      success: true,
      already: !!approved.already,
      replaced: !!bound.replaced,
    })
  } catch (e) {
    console.error('subtitle device approve:', e)
    res.status(500).json({ error: '기기 연동에 실패했습니다.' })
  }
})

/** GET /api/subtitle/device/poll?code= — 앱 폴링 */
router.get('/device/poll', async (req, res) => {
  try {
    const code = String(req.query.code || '').trim()
    if (!code) return res.status(400).json({ error: '연동 코드가 필요합니다.' })
    const polled = await db.pollSubtitleDeviceCode(code)
    if (polled.status === 'approved') {
      if (!polled.user_id || !polled.token) {
        return res.json({ status: 'denied', code: 'invalid_session', error: '연동 정보가 올바르지 않습니다.' })
      }
      const entitlement = await db.ensureSubtitleEntitlement(polled.user_id)
      if (!entitlement.ok) {
        return res.json({
          status: 'denied',
          code: entitlement.code,
          error: entitlement.error,
        })
      }
      return res.json({
        status: 'approved',
        token: polled.token,
        user_name: polled.user_name,
      })
    }
    res.json({ status: polled.status })
  } catch (e) {
    console.error('subtitle device poll:', e)
    res.status(500).json({ error: '연동 상태를 확인하지 못했습니다.' })
  }
})

/** GET /api/subtitle/device/status — 마이페이지에서 현재 연결된 기기 여부 확인 */
router.get('/device/status', authMiddleware, async (req, res) => {
  try {
    const session = await db.getSubtitleDeviceSession(req.user.id)
    res.json({
      linked: !!session?.device_id,
      linked_at: session?.linked_at || null,
    })
  } catch (e) {
    console.error('subtitle device status:', e)
    res.status(500).json({ error: '연동 상태를 확인하지 못했습니다.' })
  }
})

module.exports = router
