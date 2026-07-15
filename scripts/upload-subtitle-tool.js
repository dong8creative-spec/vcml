#!/usr/bin/env node
/**
 * TadakSync2.zip → Firebase Storage 업로드
 * (기본 Storage 경로는 기존과 동일: subtitle-tool/TadakSync.zip)
 *
 * 사용:
 *   npm run upload:subtitle-tool
 *   npm run redeploy:subtitle-tool   ← 사용법 수정 후 zip 재생성 + 업로드
 *
 * node scripts/upload-subtitle-tool.js [path/to/TadakSync2.zip]
 * node scripts/upload-subtitle-tool.js --model   ← 음성인식 모델 zip 업로드
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })

const fs = require('fs')
const path = require('path')
const { resolveBucket } = require('../utils/storage')

require('../db/schema')

const STORAGE_PATH = process.env.SUBTITLE_TOOL_STORAGE_PATH || 'subtitle-tool/TadakSync.zip'
const MODEL_STORAGE_PATH = process.env.SUBTITLE_MODEL_STORAGE_PATH || 'subtitle-tool/whisper-model-large-v3.zip'

async function main() {
  const args = process.argv.slice(2)
  const isModel = args.includes('--model')
  const pathArg = args.find(a => !a.startsWith('--'))

  const defaultZip = isModel
    ? path.join(__dirname, '../tadaksync-v2/dist/whisper-model-large-v3.zip')
    : path.join(__dirname, '../tadaksync-v2/dist/TadakSync2.zip')
  const zipPath = path.resolve(pathArg || defaultZip)
  const storagePath = isModel ? MODEL_STORAGE_PATH : STORAGE_PATH
  const filename = path.basename(storagePath)

  if (!fs.existsSync(zipPath)) {
    console.error('ZIP 파일이 없습니다:', zipPath)
    console.error(isModel
      ? '먼저 node scripts/package-subtitle-tool.js --model-zip 으로 zip을 만드세요.'
      : '먼저 dist/TadakSync2 폴더를 zip으로 만든 뒤 다시 실행하세요. (npm run package:subtitle-tool)')
    process.exit(1)
  }
  const bucket = await resolveBucket()
  const file = bucket.file(storagePath)
  const mb = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1)
  console.log(`업로드 중 → gs://${bucket.name}/${storagePath} (${mb} MB)`)
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
  console.log('완료:', storagePath)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
