#!/usr/bin/env node
/**
 * TADAKSYNC AUTO FREE Windows installer → Firebase Storage 업로드 + 자동 업데이트용 릴리스 발행.
 *
 * 사용법:
 *   node scripts/upload-tadaksync-auto-free.js [설치파일 경로] [옵션]
 * 옵션:
 *   --version=1.0.1       기본값: TadakSync Auto - for windows/tadaksync_auto/__init__.py의 VERSION
 *   --required             이 버전보다 낮으면 무조건 업데이트해야 함 (기본: 권장만)
 *   --min-supported=1.0.0  이보다 낮은 버전은 --required 여부와 무관하게 강제 업데이트
 *   --message="..."        앱에 표시할 안내 문구
 *   --notes="줄1|줄2"      변경 사항 목록 (| 로 구분)
 *   --no-publish           업로드만 하고 릴리스 메타(app_releases)는 기록하지 않음
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })

const fs = require('fs')
const crypto = require('crypto')
const path = require('path')
const { resolveBucket } = require('../utils/storage')
const { signRelease } = require('../utils/updateSigning')
const db = require('../db/schema')

const STORAGE_PATH = process.env.SUBTITLE_AUTO_FREE_SETUP_PATH
  || 'subtitle-tool/TadakSync-Auto-Free-Setup.exe'
const APP_INIT_PATH = path.join(__dirname, '..', 'TadakSync Auto - for windows', 'tadaksync_auto', '__init__.py')

function parseArgs(argv) {
  const out = { _: [] }
  for (const arg of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(arg)
    if (m) out[m[1]] = m[2] === undefined ? true : m[2]
    else out._.push(arg)
  }
  return out
}

function readVersionFromAppSource() {
  if (!fs.existsSync(APP_INIT_PATH)) return null
  const text = fs.readFileSync(APP_INIT_PATH, 'utf8')
  const m = /VERSION\s*=\s*["']([\d.]+)["']/.exec(text)
  return m ? m[1] : null
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    fs.createReadStream(filePath)
      .on('data', chunk => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')))
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const defaultInstaller = path.resolve(
    __dirname,
    '../../tadaksync-build/dist/TadakSync-Free-1.0.0-Setup.exe',
  )
  const installerPath = path.resolve(args._[0] || defaultInstaller)
  if (!fs.existsSync(installerPath)) {
    console.error('설치파일이 없습니다:', installerPath)
    process.exit(1)
  }

  const bucket = await resolveBucket()
  const file = bucket.file(STORAGE_PATH)
  const size = fs.statSync(installerPath).size
  const sizeMb = (size / 1024 / 1024).toFixed(1)
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

  if (args['no-publish']) return

  const version = args.version || readVersionFromAppSource()
  if (!version) {
    console.error(
      '버전을 확인하지 못했습니다. --version=X.Y.Z 를 지정하거나 '
      + 'tadaksync_auto/__init__.py의 VERSION을 확인하세요. (릴리스 메타는 기록하지 않았습니다)'
    )
    process.exit(1)
  }
  console.log('sha256 계산 중...')
  const sha256 = await sha256File(installerPath)
  const signature = signRelease(version, sha256, size)
  if (!signature) {
    console.error(
      '서명 키가 설정되지 않았습니다 (.env의 TADAKSYNC_UPDATE_PRIVATE_KEY / TADAKSYNC_UPDATE_PUBLIC_KEY). '
      + '릴리스 메타는 기록하지 않았습니다.'
    )
    process.exit(1)
  }

  const release = await db.setAppRelease('auto', {
    version,
    sha256,
    size,
    signature,
    storage_path: STORAGE_PATH,
    required: !!args.required,
    min_supported: args['min-supported'] || null,
    message: args.message || '',
    notes: args.notes ? String(args.notes).split('|').map(s => s.trim()).filter(Boolean) : [],
    download_page_url: `${process.env.SITE_ORIGIN || 'https://vcml.kr'}/tadaksync-auto`,
  })
  console.log('릴리스 발행 완료:', JSON.stringify(release, null, 2))
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
