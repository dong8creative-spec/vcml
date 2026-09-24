#!/usr/bin/env node
/** TADAKSYNC AUTO FREE Windows installer → Firebase Storage */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })

const fs = require('fs')
const path = require('path')
const { resolveBucket } = require('../utils/storage')

require('../db/schema')

const STORAGE_PATH = process.env.SUBTITLE_AUTO_FREE_SETUP_PATH
  || 'subtitle-tool/TadakSync-Auto-Free-Setup.exe'

async function main() {
  const defaultInstaller = path.resolve(
    __dirname,
    '../../tadaksync-build/dist/TadakSync-Free-1.0.0-Setup.exe',
  )
  const installerPath = path.resolve(process.argv[2] || defaultInstaller)
  if (!fs.existsSync(installerPath)) {
    console.error('설치파일이 없습니다:', installerPath)
    process.exit(1)
  }

  const bucket = await resolveBucket()
  const file = bucket.file(STORAGE_PATH)
  const sizeMb = (fs.statSync(installerPath).size / 1024 / 1024).toFixed(1)
  console.log(`업로드 중 → gs://${bucket.name}/${STORAGE_PATH} (${sizeMb} MB)`)
  await new Promise((resolve, reject) => {
    fs.createReadStream(installerPath)
      .pipe(file.createWriteStream({
        metadata: {
          contentType: 'application/vnd.microsoft.portable-executable',
          cacheControl: 'private, max-age=0',
          contentDisposition: 'attachment; filename="TadakSync-Auto-Free-Setup.exe"',
        },
        resumable: true,
      }))
      .on('error', reject)
      .on('finish', resolve)
  })
  console.log('AUTO FREE 설치파일 업로드 완료:', STORAGE_PATH)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
