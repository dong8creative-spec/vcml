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

/** GET /api/cleaner/terminal-guide — 터미널로 여는 방법 (로그인 회원에게만 내려준다) */
const APP_PATH = '/Applications/타닥정리함.app'
router.get('/terminal-guide', authMiddleware, (req, res) => {
  res.json({
    steps: [
      {
        title: '터미널 열기',
        text: '키보드에서 ⌘(Command)+스페이스바를 누르고 「터미널」을 입력한 뒤 Enter를 눌러요.',
      },
      {
        title: '아래 명령을 복사해서 붙여넣기',
        text: '터미널 창에 붙여넣고(⌘+V) Enter를 눌러요. 화면에 아무 글자도 안 나오면 잘 된 거예요.',
        command: `xattr -dr com.apple.quarantine "${APP_PATH}"`,
        note: '인터넷에서 받은 파일에 붙는 "확인 필요" 표시만 지우는 명령이에요. 앱 파일은 바뀌지 않아요.',
      },
      {
        title: '타닥정리함 열기',
        text: 'Applications 폴더의 타닥정리함을 더블클릭하거나, 아래 명령을 붙여넣어도 열려요.',
        command: `open "${APP_PATH}"`,
      },
    ],
    notes: [
      '먼저 타닥정리함을 Applications 폴더로 옮겨 두셔야 해요. 다른 폴더에 있다면 명령 안의 경로를 그 위치로 바꿔 주세요.',
      '암호를 물어보지 않아요. 물어보는 화면이 나오면 진행하지 말고 문의해 주세요.',
      '직접 받으신 타닥정리함 파일에만 사용해 주세요.',
    ],
  })
})

module.exports = router
