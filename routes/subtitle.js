const express = require('express')
const jwt = require('jsonwebtoken')
const db = require('../db/schema')
const { authMiddleware, subtitleAppAuth, clientIp } = require('../middleware/auth')
const { recordLoginLog } = require('../utils/loginAudit')
const { getSignedDownloadUrl } = require('../utils/storage')

const router = express.Router()

const SUBTITLE_ZIP_PATH = process.env.SUBTITLE_TOOL_STORAGE_PATH || 'subtitle-tool/TadakSync.zip'
const SUBTITLE_MODEL_ZIP_PATH = process.env.SUBTITLE_MODEL_STORAGE_PATH || 'subtitle-tool/whisper-model-large-v3.zip'
const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://vcml.kr'
const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions'
const TRANSLATION_LANGUAGES = {
  en: '영어',
  ja: '일본어',
  zh: '중국어(간체)',
}

function parseSubtitleDurationUs(body) {
  const raw = body?.duration_us
  if (raw != null && raw !== '') {
    return Math.max(0, parseInt(raw, 10) || 0)
  }
  const mins = Number(body?.minutes)
  if (Number.isFinite(mins) && mins > 0) {
    return db.subtitleDurationUsFromMinutes(mins)
  }
  return 0
}

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

function extractJsonObject(text) {
  const raw = String(text || '').trim()
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch (_) {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (fenced) {
      try { return JSON.parse(fenced[1]) } catch (_) {}
    }
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try { return JSON.parse(raw.slice(start, end + 1)) } catch (_) {}
    }
  }
  return null
}

function normalizeTranslationBlocks(blocks) {
  if (!Array.isArray(blocks)) return []
  return blocks.map((b, idx) => ({
    index: Number.isFinite(Number(b?.index)) ? Number(b.index) : idx,
    text: String(b?.text || b?.translation || '').trim(),
  }))
}

async function translateScriptWithOpenAI({ sourceLang, targetLang, scriptText, blocks }) {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim()
  if (!apiKey) {
    const err = new Error('번역 엔진 설정이 아직 준비되지 않았습니다.')
    err.status = 503
    throw err
  }
  const targetName = TRANSLATION_LANGUAGES[targetLang]
  if (!targetName) {
    const err = new Error('지원하지 않는 번역 언어입니다.')
    err.status = 400
    throw err
  }
  const sourceName = sourceLang ? String(sourceLang) : '자동 감지된 원어'
  const safeBlocks = (Array.isArray(blocks) ? blocks : [])
    .map((b, idx) => ({
      index: idx,
      text: String(b?.text || '').trim(),
    }))
    .filter(b => b.text)
  const system = [
    'You are a senior subtitle translator for short-form and course videos.',
    'Translate with full-context awareness, natural spoken delivery, and consistent terms.',
    'Return strict JSON only. Do not include markdown.',
  ].join(' ')
  const user = JSON.stringify({
    task: 'Translate subtitle script while preserving block count and index order.',
    source_language: sourceName,
    target_language: targetName,
    style: 'Natural spoken subtitles. Keep meaning concise, fluent, and viewer-friendly.',
    constraints: [
      'Return JSON object: {"translations":[{"index":0,"text":"..."}]}',
      'translations length must equal blocks length.',
      'Each index must match the source block index.',
      'Do not merge or split blocks.',
      'No explanations.',
    ],
    full_script: String(scriptText || '').trim(),
    blocks: safeBlocks,
  })
  const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.SUBTITLE_TRANSLATION_MODEL || 'gpt-4o',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const err = new Error(payload?.error?.message || '번역 엔진 호출에 실패했습니다.')
    err.status = response.status
    throw err
  }
  const content = payload?.choices?.[0]?.message?.content || ''
  const parsed = extractJsonObject(content)
  const translations = normalizeTranslationBlocks(parsed?.translations)
  if (translations.length !== safeBlocks.length || translations.some((t, idx) => t.index !== idx || !t.text)) {
    const err = new Error('번역 결과 형식이 올바르지 않습니다. 다시 시도해 주세요.')
    err.status = 502
    throw err
  }
  return {
    target_language: targetLang,
    target_language_label: targetName,
    translations,
    usage: payload?.usage || null,
    model: payload?.model || process.env.SUBTITLE_TRANSLATION_MODEL || 'gpt-4o',
  }
}

/** GET /api/subtitle/entitlement — 구글 로그인·잔액 확인 (회원 기본 10코인 + 일일 로그인 1코인) */
router.get('/entitlement', authMiddleware, async (req, res) => {
  try {
    const result = await db.ensureSubtitleEntitlement(req.user.id)
    if (!result.ok) {
      return res.status(403).json(result)
    }
    res.json({
      ...result,
      pricing: db.getSubtitlePricingLaunchMeta(),
    })
  } catch (e) {
    console.error('subtitle entitlement:', e)
    res.status(500).json({ error: '이용 권한을 확인하지 못했습니다.' })
  }
})

/** GET /api/subtitle/wallet — 웹용 잔액/사용 내역 (일일 로그인 보너스 포함) */
router.get('/wallet', authMiddleware, async (req, res) => {
  try {
    const entitlement = await db.ensureSubtitleEntitlement(req.user.id)
    if (!entitlement.ok) {
      return res.status(403).json(entitlement)
    }
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50))
    const history = await db.getSubtitleCoinHistory(req.user.id, limit)
    res.json({
      balance: entitlement.balance ?? 0,
      updated_at: (await db.getSubtitleWallet(req.user.id))?.updated_at || null,
      history,
      just_granted_initial: entitlement.just_granted_initial,
      just_granted_daily: entitlement.just_granted_daily,
      pricing: db.getSubtitlePricingLaunchMeta(),
    })
  } catch (e) {
    console.error('subtitle wallet:', e)
    res.status(500).json({ error: '코인 정보를 불러오지 못했습니다.' })
  }
})

/** GET /api/subtitle/me — 잔액 조회 (앱 전용, 1계정 1기기) */
router.get('/me', subtitleAppAuth, async (req, res) => {
  try {
    const result = await db.ensureSubtitleEntitlement(req.user.id)
    if (!result.ok) {
      return res.status(403).json(result)
    }
    const user = await db.findUserById(req.user.id)
    const refreshedToken = signSubtitleToken(
      user || req.user,
      req.user.device_id,
      req.user.session_id,
    )
    res.json({
      email: req.user.email || null,
      name: req.user.name || null,
      token: refreshedToken,
      balance: result.balance,
      initial_granted: result.initial_granted,
      daily_login_granted_today: result.daily_login_granted_today,
      just_granted_daily: result.just_granted_daily,
      review_bonus_granted: result.review_bonus_granted,
      has_review: !!result.has_review,
      course_slug: result.course_slug,
      course_title: result.course_title,
      course_id: result.course_id || null,
      coin_courses: result.coin_courses || [],
      enrolled: !!result.enrolled,
      has_google: !!result.has_google,
      community_instagram_url: result.community_instagram_url || null,
      community_chat_url: result.community_chat_url || null,
      community_website_url: result.community_website_url || SITE_ORIGIN,
      smartstore_review: result.smartstore_review || null,
      pending_actions: result.pending_actions || [],
      billing: db.getSubtitleBillingMeta(),
    })
  } catch (e) {
    console.error('subtitle me:', e)
    res.status(500).json({ error: '잔액을 불러오지 못했습니다.' })
  }
})

/** POST /api/subtitle/smartstore-review/claim — 앱에서 스마트스토어 후기 작성 완료 신고 */
router.post('/smartstore-review/claim', subtitleAppAuth, async (req, res) => {
  try {
    const entitlement = await db.ensureSubtitleEntitlement(req.user.id)
    if (!entitlement.ok) {
      return res.status(403).json(entitlement)
    }
    const result = await db.claimSmartstoreReview(req.user.id)
    if (!result.ok) {
      const status = result.code === 'already_pending' || result.code === 'already_approved' ? 409 : 400
      return res.status(status).json(result)
    }
    res.json({
      ...result,
      smartstore_review: await db.getSmartstoreReviewState(req.user.id),
    })
  } catch (e) {
    console.error('subtitle smartstore review claim:', e)
    res.status(500).json({ error: '스마트스토어 후기 신고를 접수하지 못했습니다.' })
  }
})

/** POST /api/subtitle/inbox/ack — 앱 안내 메시지 확인 처리 */
router.post('/inbox/ack', subtitleAppAuth, async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.message_ids) ? req.body.message_ids : []
    res.json(await db.ackSubtitleAppInbox(req.user.id, ids))
  } catch (e) {
    console.error('subtitle inbox ack:', e)
    res.status(500).json({ error: '알림 확인 처리에 실패했습니다.' })
  }
})

/** GET /api/subtitle/history — 코인 사용/지급 내역 (앱 전용) */
router.get('/history', subtitleAppAuth, async (req, res) => {
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
    const storagePath = String(result.storage_path || '').trim() || SUBTITLE_ZIP_PATH
    const filename = storagePath.split('/').pop() || 'TadakSync.zip'
    const url = await getSignedDownloadUrl(storagePath, 15 * 60 * 1000)
    res.json({ url, filename, expires_in: 900 })
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
    const deviceId = String(req.body?.device_id || '').trim().slice(0, 64)
    if (!deviceId) {
      return res.status(400).json({ error: '기기 정보가 필요합니다.', code: 'device_required' })
    }
    const { code, expires_at } = await db.createSubtitleDeviceCode(deviceId)
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

/** POST /api/subtitle/consume — { duration_us, job_id } 전문 인식 (앱 전용) */
router.post('/consume', subtitleAppAuth, async (req, res) => {
  try {
    const durationUs = parseSubtitleDurationUs(req.body)
    const jobId = req.body?.job_id
    if (!durationUs) {
      return res.status(400).json({ ok: false, code: 'invalid_duration', error: 'duration_us가 필요합니다.' })
    }
    const result = await db.consumeSubtitleCoins(req.user.id, jobId, durationUs)
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

/** POST /api/subtitle/refund — { job_id } (앱 전용) */
router.post('/refund', subtitleAppAuth, async (req, res) => {
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

/** POST /api/subtitle/consume-lines — 직접 줄 나눔 코인 차감 (앱 전용) */
router.post('/consume-lines', subtitleAppAuth, async (req, res) => {
  try {
    const durationUs = parseSubtitleDurationUs(req.body)
    const jobId = req.body?.job_id
    if (!durationUs) {
      return res.status(400).json({ ok: false, code: 'invalid_duration', error: 'duration_us가 필요합니다.' })
    }
    const result = await db.consumeSubtitleLineSplitCoins(req.user.id, jobId, durationUs, req.body?.split_mode)
    if (!result.ok) {
      const status = result.code === 'insufficient' ? 402 : result.code === 'invalid_job' ? 400 : 403
      return res.status(status).json(result)
    }
    res.json(result)
  } catch (e) {
    console.error('subtitle consume-lines:', e)
    res.status(500).json({ error: '줄 나눔 코인 차감에 실패했습니다.' })
  }
})

/** POST /api/subtitle/refund-lines — 줄 나눔 실패 환불 (앱 전용) */
router.post('/refund-lines', subtitleAppAuth, async (req, res) => {
  try {
    const jobId = req.body?.job_id
    const result = await db.refundSubtitleLineSplitCoins(req.user.id, jobId)
    if (!result.ok) {
      const status = result.code === 'invalid_job' || result.code === 'no_consume' ? 400 : 403
      return res.status(status).json(result)
    }
    res.json(result)
  } catch (e) {
    console.error('subtitle refund-lines:', e)
    res.status(500).json({ error: '줄 나눔 코인 환불에 실패했습니다.' })
  }
})

/** POST /api/subtitle/consume-translation — 번역 코인만 차감 (앱 로컬 번역용) */
router.post('/consume-translation', subtitleAppAuth, async (req, res) => {
  try {
    const durationUs = parseSubtitleDurationUs(req.body)
    const jobId = req.body?.job_id
    if (!durationUs) {
      return res.status(400).json({ ok: false, code: 'invalid_duration', error: 'duration_us가 필요합니다.' })
    }
    const result = await db.consumeSubtitleTranslationCoins(req.user.id, jobId, durationUs)
    if (!result.ok) {
      const status = result.code === 'insufficient' ? 402 : result.code === 'invalid_job' ? 400 : 403
      return res.status(status).json(result)
    }
    res.json(result)
  } catch (e) {
    console.error('subtitle consume-translation:', e)
    res.status(500).json({ error: '번역 코인 차감에 실패했습니다.' })
  }
})

/** POST /api/subtitle/refund-translation — 로컬 번역 실패 시 환불 (앱 전용) */
router.post('/refund-translation', subtitleAppAuth, async (req, res) => {
  try {
    const jobId = req.body?.job_id
    const result = await db.refundSubtitleTranslationCoins(req.user.id, jobId)
    if (!result.ok) {
      const status = result.code === 'invalid_job' || result.code === 'no_consume' ? 400 : 403
      return res.status(status).json(result)
    }
    res.json(result)
  } catch (e) {
    console.error('subtitle refund-translation:', e)
    res.status(500).json({ error: '번역 코인 환불에 실패했습니다.' })
  }
})

/** POST /api/subtitle/translate — GPT-4o 전문 맥락 번역 (앱 전용) */
router.post('/translate', subtitleAppAuth, async (req, res) => {
  const jobId = String(req.body?.job_id || '').trim()
  let consumed = false
  try {
    const durationUs = parseSubtitleDurationUs(req.body)
    const sourceLang = req.body?.source_lang
    const targetLang = String(req.body?.target_lang || '').trim()
    const scriptText = String(req.body?.script_text || '').trim()
    const blocks = Array.isArray(req.body?.blocks) ? req.body.blocks : []
    if (!jobId) return res.status(400).json({ ok: false, code: 'invalid_job', error: 'job_id가 필요합니다.' })
    if (!TRANSLATION_LANGUAGES[targetLang]) {
      return res.status(400).json({ ok: false, code: 'invalid_language', error: '지원하지 않는 번역 언어입니다.' })
    }
    if (!scriptText || !blocks.length) {
      return res.status(400).json({ ok: false, code: 'empty_script', error: '번역할 자막 전문이 없습니다.' })
    }
    if (!durationUs) {
      return res.status(400).json({ ok: false, code: 'invalid_duration', error: 'duration_us가 필요합니다.' })
    }
    if (!String(process.env.OPENAI_API_KEY || '').trim()) {
      return res.status(503).json({ ok: false, code: 'translation_not_configured', error: '번역 엔진 설정이 아직 준비되지 않았습니다.' })
    }

    const charge = await db.consumeSubtitleTranslationCoins(req.user.id, jobId, durationUs)
    if (!charge.ok) {
      const status = charge.code === 'insufficient' ? 402 : charge.code === 'invalid_job' ? 400 : 403
      return res.status(status).json(charge)
    }
    consumed = !charge.already

    const translated = await translateScriptWithOpenAI({
      sourceLang,
      targetLang,
      scriptText,
      blocks,
    })
    res.json({
      ok: true,
      balance: charge.balance,
      minutes: charge.minutes,
      coins: charge.coins,
      ...translated,
    })
  } catch (e) {
    console.error('subtitle translate:', e)
    if (consumed && jobId) {
      try {
        await db.refundSubtitleTranslationCoins(req.user.id, jobId)
      } catch (refundErr) {
        console.error('subtitle translate refund:', refundErr)
      }
    }
    const status = e.status && Number.isFinite(Number(e.status)) ? Number(e.status) : 500
    res.status(status >= 400 && status < 600 ? status : 500).json({
      ok: false,
      error: e.message || '번역에 실패했습니다.',
    })
  }
})

module.exports = router
