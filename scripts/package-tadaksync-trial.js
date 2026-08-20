#!/usr/bin/env node
/**
 * 타닥싱크 체험판 포터블 폴더를 정리하고 배포 zip으로 만든다.
 *
 * 결과:
 *   tadaksync-trial/dist/TadakSyncTrial.zip
 *   └─ TadakSyncTrial/
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const SOURCE_DIR = path.join(ROOT, 'tadaksync-trial')
const DIST_DIR = path.join(SOURCE_DIR, 'dist')
const ZIP_PATH = path.join(DIST_DIR, 'TadakSyncTrial.zip')

const REQUIRED_FILES = [
  'run.bat',
  'runtime/pythonw.exe',
  'models/faster-whisper-base/model.bin',
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
  if (parts.includes('__pycache__')) return false
  if (name.endsWith('.pyc') || name === 'last_error.txt') return false
  return true
}

function verifyBundle(root) {
  const missing = REQUIRED_FILES.filter(file => !fs.existsSync(path.join(root, file)))
  if (missing.length) {
    console.error('체험판 배포 필수 파일이 없습니다:')
    for (const file of missing) console.error(`  - ${file}`)
    console.error('먼저 tadaksync-trial/prepare_bundle.ps1을 실행해 runtime과 models를 준비하세요.')
    process.exit(1)
  }
}

function createZip(stageDir) {
  if (fs.existsSync(ZIP_PATH)) fs.rmSync(ZIP_PATH, { force: true })
  const stageParent = path.dirname(stageDir)
  const folder = path.basename(stageDir)
  if (process.platform === 'win32') {
    execFileSync('tar.exe', ['-a', '-cf', ZIP_PATH, '-C', stageParent, folder], {
      stdio: 'inherit',
    })
  } else {
    execFileSync('zip', ['-r', '-q', ZIP_PATH, folder], {
      cwd: stageParent,
      stdio: 'inherit',
    })
  }
}

const MODEL_PART_BYTES = 24 * 1024 * 1024

/** 백신·압축 프로그램이 138MB짜리 model.bin 하나를 막는 일이 있어 조각으로 나눠 담는다. */
function splitModel(stageDir) {
  const modelPath = path.join(stageDir, 'models/faster-whisper-base/model.bin')
  if (!fs.existsSync(modelPath)) return
  const total = fs.statSync(modelPath).size
  const fd = fs.openSync(modelPath, 'r')
  const buffer = Buffer.alloc(MODEL_PART_BYTES)
  let index = 0
  let offset = 0
  try {
    while (offset < total) {
      const read = fs.readSync(fd, buffer, 0, MODEL_PART_BYTES, offset)
      if (read <= 0) break
      index += 1
      const part = `${modelPath}.part${String(index).padStart(2, '0')}`
      fs.writeFileSync(part, buffer.subarray(0, read))
      offset += read
    }
  } finally {
    fs.closeSync(fd)
  }
  fs.rmSync(modelPath, { force: true })
  console.log(`음성인식 모델을 ${index}조각으로 나눠 담았습니다. (첫 실행에서 자동으로 합칩니다)`)
}

function main() {
  verifyBundle(SOURCE_DIR)
  fs.rmSync(DIST_DIR, { recursive: true, force: true })
  fs.mkdirSync(DIST_DIR, { recursive: true })
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tadaksync-trial-'))
  const stageDir = path.join(tempRoot, 'TadakSyncTrial')
  try {
    fs.cpSync(SOURCE_DIR, stageDir, {
      recursive: true,
      filter: shouldCopy,
    })
    verifyBundle(stageDir)
    splitModel(stageDir)
    createZip(stageDir)

    const sizeMb = (fs.statSync(ZIP_PATH).size / 1024 / 1024).toFixed(1)
    console.log(`체험판 zip 생성 완료: ${path.relative(ROOT, ZIP_PATH)} (${sizeMb} MB)`)
    console.log('압축 최상단 폴더: TadakSyncTrial/')
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

main()
