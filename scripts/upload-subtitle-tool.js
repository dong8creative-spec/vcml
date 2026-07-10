#!/usr/bin/env node
/**
 * CapCutSubtitle.zip → Firebase Storage 업로드
 * 사용: node scripts/upload-subtitle-tool.js [path/to/CapCutSubtitle.zip]
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })

const fs = require('fs')
const path = require('path')
const { resolveBucket } = require('../utils/storage')

// schema 로드로 Firebase Admin 초기화
require('../db/schema')

const STORAGE_PATH = process.env.SUBTITLE_TOOL_STORAGE_PATH || 'subtitle-tool/CapCutSubtitle.zip'

async function main() {
  const zipPath = path.resolve(
    process.argv[2]
    || path.join(__dirname, '../capcut subtitle/dist/CapCutSubtitle.zip')
  )
  if (!fs.existsSync(zipPath)) {
    console.error('ZIP 파일이 없습니다:', zipPath)
    console.error('먼저 dist/CapCutSubtitle 폴더를 zip으로 만든 뒤 다시 실행하세요.')
    process.exit(1)
  }
  const buffer = fs.readFileSync(zipPath)
  const bucket = await resolveBucket()
  const file = bucket.file(STORAGE_PATH)
  console.log(`업로드 중 → gs://${bucket.name}/${STORAGE_PATH} (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`)
  await file.save(buffer, {
    metadata: {
      contentType: 'application/zip',
      cacheControl: 'private, max-age=0',
      contentDisposition: 'attachment; filename="CapCutSubtitle.zip"',
    },
    resumable: true,
  })
  console.log('완료:', STORAGE_PATH)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
