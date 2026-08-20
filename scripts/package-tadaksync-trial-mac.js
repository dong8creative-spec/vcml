#!/usr/bin/env node
/**
 * 타닥싱크 체험판(맥) zip을 만든다.
 *
 * 결과:
 *   tadaksync-trial-mac/dist/TadakSyncTrial-mac.zip
 *   └─ TadakSyncTrial-mac/
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const SOURCE_DIR = path.join(ROOT, 'tadaksync-trial-mac')
const DIST_DIR = path.join(SOURCE_DIR, 'dist')
const ZIP_PATH = path.join(DIST_DIR, 'TadakSyncTrial-mac.zip')
const LAUNCHER = '타닥싱크 체험 실행.command'

const REQUIRED_FILES = [
  LAUNCHER,
  'run.py',
  'requirements.txt',
  'web/index.html',
  'engine/transcribe.py',
  '사용법.txt',
]

function shouldCopy(src) {
  const relative = path.relative(SOURCE_DIR, src)
  if (!relative) return true
  const parts = relative.split(path.sep)
  const name = path.basename(src)
  if (parts[0] === 'dist') return false
  if (parts[0] === '.venv') return false
  if (parts.includes('__pycache__')) return false
  if (name.endsWith('.pyc') || name === 'last_error.txt') return false
  return true
}

function verifyBundle(root) {
  const missing = REQUIRED_FILES.filter(file => !fs.existsSync(path.join(root, file)))
  if (missing.length) {
    console.error('맥 체험판 배포 필수 파일이 없습니다:')
    for (const file of missing) console.error(`  - ${file}`)
    process.exit(1)
  }
}

function createZip(stageDir) {
  if (fs.existsSync(ZIP_PATH)) fs.rmSync(ZIP_PATH, { force: true })
  const stageParent = path.dirname(stageDir)
  const folder = path.basename(stageDir)
  execFileSync('zip', ['-r', '-q', ZIP_PATH, folder], {
    cwd: stageParent,
    stdio: 'inherit',
  })
}

function main() {
  verifyBundle(SOURCE_DIR)
  fs.chmodSync(path.join(SOURCE_DIR, LAUNCHER), 0o755)
  fs.rmSync(DIST_DIR, { recursive: true, force: true })
  fs.mkdirSync(DIST_DIR, { recursive: true })
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tadaksync-trial-mac-'))
  const stageDir = path.join(tempRoot, 'TadakSyncTrial-mac')
  try {
    fs.cpSync(SOURCE_DIR, stageDir, {
      recursive: true,
      filter: shouldCopy,
    })
    fs.chmodSync(path.join(stageDir, LAUNCHER), 0o755)
    verifyBundle(stageDir)
    createZip(stageDir)

    const bytes = fs.statSync(ZIP_PATH).size
    const sizeLabel = bytes >= 1024 * 1024
      ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
      : `${Math.max(1, Math.round(bytes / 1024))} KB`
    console.log(`맥 체험판 zip 생성 완료: ${path.relative(ROOT, ZIP_PATH)} (${sizeLabel})`)
    console.log('압축 최상단 폴더: TadakSyncTrial-mac/')
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

main()
