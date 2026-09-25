const express = require('express')
const db = require('../db/schema')
const { getSignedDownloadUrl } = require('../utils/storage')

const router = express.Router()

const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://vcml.kr'
const VERSION_RE = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/

function parseVersion(v) {
  const m = VERSION_RE.exec(String(v || '').trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** a<b: -1, a===b: 0, a>b: 1, 파싱 불가: null */
function compareVersions(a, b) {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return null
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1
  }
  return 0
}

/** GET /api/app/update?client=auto&version=1.0.0 — 데스크톱 앱 자체 업데이트 확인 (인증 불필요, fail-open) */
router.get('/update', async (req, res) => {
  try {
    const client = String(req.query.client || '').trim()
    const current = String(req.query.version || '').trim()
    if (!client) return res.json({ status: 'unknown' })

    const release = await db.getAppRelease(client)
    if (!release?.version || !release?.storage_path) {
      return res.json({ status: 'unknown' })
    }

    const cmp = compareVersions(current, release.version)
    if (cmp === null) return res.json({ status: 'unknown' })
    if (cmp >= 0) return res.json({ status: 'up_to_date', latest: release.version })

    const belowMinSupported = release.min_supported
      && compareVersions(current, release.min_supported) === -1
    const status = release.required || belowMinSupported ? 'required' : 'recommended'
    const url = await getSignedDownloadUrl(release.storage_path, 15 * 60 * 1000)

    res.json({
      status,
      latest: release.version,
      min_supported: release.min_supported || '',
      message: release.message || '',
      download_page_url: release.download_page_url || `${SITE_ORIGIN}/tadaksync-auto`,
      release: {
        version: release.version,
        sha256: release.sha256,
        size: release.size,
        signature: release.signature,
        url,
        notes: release.notes || [],
      },
    })
  } catch (e) {
    console.error('app update check:', e)
    res.json({ status: 'unknown' })
  }
})

module.exports = router
