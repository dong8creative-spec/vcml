const express = require('express')
const { authMiddleware } = require('../middleware/auth')
const { getSignedDownloadUrl } = require('../utils/storage')

const router = express.Router()

const CLEANER_DMG_PATH = process.env.TADAK_CLEANER_STORAGE_PATH || 'tadak-cleaner/TadakCleaner-0.9.1-universal.dmg'
const CLEANER_FILENAME = '타닥정리함-0.9.1-universal.dmg'

/** GET /api/cleaner/download — 로그인 회원용 타닥정리함(.dmg) 서명 URL */
router.get('/download', authMiddleware, async (req, res) => {
  try {
    const url = await getSignedDownloadUrl(CLEANER_DMG_PATH, 15 * 60 * 1000)
    res.json({ url, filename: CLEANER_FILENAME, expires_in: 900 })
  } catch (e) {
    console.error('cleaner download:', e)
    const missing = /찾을 수 없습니다/.test(e.message || '')
    res.status(missing ? 404 : 500).json({
      error: missing
        ? '다운로드 파일이 아직 준비되지 않았습니다. 잠시 후 다시 시도해주세요.'
        : '다운로드 링크를 만들지 못했습니다.',
    })
  }
})

module.exports = router
