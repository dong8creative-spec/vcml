#!/usr/bin/env node
/**
 * 타닥정리함 설치 파일(.dmg)을 Firebase Storage에 업로드한다.
 *
 * 사용:
 *   node scripts/upload-tadak-cleaner.js "/path/to/타닥정리함-0.9.1-universal.dmg"
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })

const fs = require('fs')
const path = require('path')
const { resolveBucket } = require('../utils/storage')

require('../db/schema')

const STORAGE_PATH = process.env.TADAK_CLEANER_STORAGE_PATH
  || 'tadak-cleaner/TadakCleaner-0.9.1-universal.dmg'
const DOWNLOAD_NAME = '타닥정리함-0.9.1-universal.dmg'

async function main() {
  const src = process.argv[2]
  if (!src) {
    console.error('사용법: node scripts/upload-tadak-cleaner.js <dmg 경로>')
    process.exit(1)
  }
  const dmgPath = path.resolve(src)
  if (!fs.existsSync(dmgPath)) {
    console.error('dmg 파일이 없습니다:', dmgPath)
    process.exit(1)
  }

  const bucket = await resolveBucket()
  const file = bucket.file(STORAGE_PATH)
  const mb = (fs.statSync(dmgPath).size / 1024 / 1024).toFixed(1)
  console.log(`업로드 중 → gs://${bucket.name}/${STORAGE_PATH} (${mb} MB)`)
  await new Promise((resolve, reject) => {
    fs.createReadStream(dmgPath)
      .pipe(file.createWriteStream({
        metadata: {
          contentType: 'application/x-apple-diskimage',
          cacheControl: 'private, max-age=0',
          contentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(DOWNLOAD_NAME)}`,
        },
        resumable: true,
      }))
      .on('error', reject)
      .on('finish', resolve)
  })
  console.log('타닥정리함 업로드 완료:', STORAGE_PATH)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
