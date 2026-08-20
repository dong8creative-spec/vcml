#!/usr/bin/env node
/**
 * TadakSyncTrial-mac.zip을 Firebase Storage에 업로드한다. (윈도우 체험판과 경로 분리)
 *
 * 사용:
 *   npm run upload:subtitle-trial-mac
 *   node scripts/upload-tadaksync-trial-mac.js [path/to/TadakSyncTrial-mac.zip]
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })

const fs = require('fs')
const path = require('path')
const { resolveBucket } = require('../utils/storage')

require('../db/schema')

const STORAGE_PATH = process.env.SUBTITLE_TRIAL_MAC_STORAGE_PATH
  || 'subtitle-tool/TadakSyncTrial-mac.zip'

async function main() {
  const defaultZip = path.join(
    __dirname,
    '../tadaksync-trial-mac/dist/TadakSyncTrial-mac.zip',
  )
  const zipPath = path.resolve(process.argv[2] || defaultZip)
  if (!fs.existsSync(zipPath)) {
    console.error('맥 체험판 zip 파일이 없습니다:', zipPath)
    console.error('먼저 npm run package:subtitle-trial-mac을 실행하세요.')
    process.exit(1)
  }

  const bucket = await resolveBucket()
  const file = bucket.file(STORAGE_PATH)
  const filename = path.basename(STORAGE_PATH)
  const mb = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1)
  console.log(`업로드 중 → gs://${bucket.name}/${STORAGE_PATH} (${mb} MB)`)
  await new Promise((resolve, reject) => {
    fs.createReadStream(zipPath)
      .pipe(file.createWriteStream({
        metadata: {
          contentType: 'application/zip',
          cacheControl: 'private, max-age=0',
          contentDisposition: `attachment; filename="${filename}"`,
        },
        resumable: true,
      }))
      .on('error', reject)
      .on('finish', resolve)
  })
  console.log('맥 체험판 업로드 완료:', STORAGE_PATH)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
