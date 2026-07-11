const express = require('express')
const jwt = require('jsonwebtoken')
const db = require('../db/schema')
const { authMiddleware } = require('../middleware/auth')
const { getSignedDownloadUrl } = require('../utils/storage')

const router = express.Router()

const SUBTITLE_ZIP_PATH = process.env.SUBTITLE_TOOL_STORAGE_PATH || 'subtitle-tool/TadakSync.zip'
const SUBTITLE_MODEL_ZIP_PATH = process.env.SUBTITLE_MODEL_STORAGE_PATH || 'subtitle-tool/whisper-model-large-v3.zip'
const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://vcml.kr'

function signUserToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      member_type: user.member_type || 'student',
      profileComplete: !!user.profile_complete,
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  )
}

/** GET /api/subtitle/entitlement — 수강·구글·잔액 확인 (최초 100코인 지급) */
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

/** GET /api/subtitle/me — 잔액 조회 */
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const result = await db.ensureSubtitleEntitlement(req.user.id)
    if (!result.ok) {
      return res.status(403).json(result)
    }
    res.json({
      email: req.user.email || null,
      name: req.user.name || null,
      balance: result.balance,
      initial_granted: result.initial_granted,
      review_bonus_granted: result.review_bonus_granted,
      course_slug: result.course_slug,
      course_title: result.course_title,
      enrolled: !!result.enrolled,
      has_google: !!result.has_google,
    })
  } catch (e) {
    console.error('subtitle me:', e)
    res.status(500).json({ error: '잔액을 불러오지 못했습니다.' })
  }
})

/** GET /api/subtitle/history — 코인 사용/지급 내역 */
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const result = await db.ensureSubtitleEntitlement(req.user.id)
    if (!result.ok) {
      return res.status(403).json(result)
    }
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30))
    const history = await db.getSubtitleCoinHistory(req.user.id, limit)
    res.json({ history })
  } catch (e) {
    console.error('subtitle history:', e)
    res.status(500).json({ error: '사용 내역을 불러오지 못했습니다.' })
  }
})

/** GET /api/subtitle/download — 서명 URL */
router.get('/download', authMiddleware, async (req, res) => {
  try {
    const result = await db.ensureSubtitleEntitlement(req.user.id)
    if (!result.ok) {
      return res.status(403).json(result)
    }
    const url = await getSignedDownloadUrl(SUBTITLE_ZIP_PATH, 15 * 60 * 1000)
    res.json({ url, filename: 'TadakSync.zip', expires_in: 900 })
  } catch (e) {
    console.error('subtitle download:', e)
    const missing = /찾을 수 없습니다/.test(e.message || '')
    res.status(missing ? 404 : 500).json({
      error: missing
        ? '다운로드 파일이 아직 준비되지 않았습니다. 잠시 후 다시 시도해주세요.'
        : '다운로드 링크를 만들지 못했습니다.',
    })
  }
})

/** GET /api/subtitle/download-model — 음성인식 모델 zip 서명 URL
 * (자동 다운로드가 안 되는 환경용. 프로그램 폴더의 models\faster-whisper-large-v3 에 압축 해제) */
router.get('/download-model', authMiddleware, async (req, res) => {
  try {
    const result = await db.ensureSubtitleEntitlement(req.user.id)
    if (!result.ok) {
      return res.status(403).json(result)
    }
    const url = await getSignedDownloadUrl(SUBTITLE_MODEL_ZIP_PATH, 60 * 60 * 1000)
    res.json({ url, filename: 'whisper-model-large-v3.zip', expires_in: 3600 })
  } catch (e) {
    console.error('subtitle download-model:', e)
    const missing = /찾을 수 없습니다/.test(e.message || '')
    res.status(missing ? 404 : 500).json({
      error: missing
        ? '모델 파일이 아직 준비되지 않았습니다. 잠시 후 다시 시도해주세요.'
        : '다운로드 링크를 만들지 못했습니다.',
    })
  }
})

/** POST /api/subtitle/device/start — 앱이 연동 코드 발급 (인증 불필요) */
router.post('/device/start', async (req, res) => {
  try {
    const { code, expires_at } = await db.createSubtitleDeviceCode()
    res.json({
      code,
      expires_at,
      verify_url: `${SITE_ORIGIN}/subtitle-tool.html?code=${encodeURIComponent(code)}`,
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

    const token = signUserToken(user)
    const approved = await db.approveSubtitleDeviceCode(code, user.id, token, user.name)
    if (!approved.ok) {
      const status = approved.code === 'expired' || approved.code === 'invalid_code' ? 400 : 409
      return res.status(status).json(approved)
    }
    res.json({
      success: true,
      already: !!approved.already,
      balance: entitlement.balance,
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
      let balance = entitlement.balance ?? null
      if (balance == null && polled.user_id) {
        const wallet = await db.getSubtitleWallet(polled.user_id)
        balance = wallet?.balance ?? null
      }
      return res.json({
        status: 'approved',
        token: polled.token,
        user_name: polled.user_name,
        balance,
      })
    }
    res.json({ status: polled.status })
  } catch (e) {
    console.error('subtitle device poll:', e)
    res.status(500).json({ error: '연동 상태를 확인하지 못했습니다.' })
  }
})

/** POST /api/subtitle/consume — { minutes, job_id } */
router.post('/consume', authMiddleware, async (req, res) => {
  try {
    const minutes = req.body?.minutes
    const jobId = req.body?.job_id
    const result = await db.consumeSubtitleCoins(req.user.id, minutes, jobId)
    if (!result.ok) {
      const status = result.code === 'insufficient' ? 402 : result.code === 'invalid_job' ? 400 : 403
      return res.status(status).json(result)
    }
    res.json(result)
  } catch (e) {
    console.error('subtitle consume:', e)
    res.status(500).json({ error: '코인 차감에 실패했습니다.' })
  }
})

/** POST /api/subtitle/refund — { job_id } */
router.post('/refund', authMiddleware, async (req, res) => {
  try {
    const jobId = req.body?.job_id
    const result = await db.refundSubtitleCoins(req.user.id, jobId)
    if (!result.ok) {
      const status = result.code === 'invalid_job' || result.code === 'no_consume' ? 400 : 403
      return res.status(status).json(result)
    }
    res.json(result)
  } catch (e) {
    console.error('subtitle refund:', e)
    res.status(500).json({ error: '코인 환불에 실패했습니다.' })
  }
})

module.exports = router
