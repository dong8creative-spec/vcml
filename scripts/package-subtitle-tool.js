#!/usr/bin/env node
/**
 * 타닥싱크 2 (TadakSync 2) 배포 zip 패키징
 *
 * 1) tadaksync-v2/dist/TadakSync2 에 사용법 등 문서 복사
 * 2) TadakSync2.zip 생성 (업로드 시 Storage 경로 subtitle-tool/TadakSync.zip 로 덮어씀)
 *
 * 사용법 파일 위치:
 *   tadaksync-v2/사용법.txt   ← 수강생용 (필수)
 *   tadaksync-v2/사용법.md    ← 수강생용 (필수, txt와 동기화)
 *
 * 사용:
 *   node scripts/package-subtitle-tool.js               # 경량 zip (모델 미포함)
 *   node scripts/package-subtitle-tool.js --with-model  # 풀버전 zip (~3.2GB)
 *   node scripts/package-subtitle-tool.js --model-zip   # 모델 단독 zip
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const APP_DIR = path.join(ROOT, 'tadaksync-v2')
const DIST_DIR = path.join(APP_DIR, 'dist', 'TadakSync2')
const ZIP_PATH = path.join(APP_DIR, 'dist', 'TadakSync2.zip')
const FULL_ZIP_PATH = path.join(APP_DIR, 'dist', 'TadakSync2-full.zip')
const MODEL_ZIP_PATH = path.join(APP_DIR, 'dist', 'whisper-model-large-v3.zip')
const MODEL_NAME = 'faster-whisper-large-v3'
const EXE_NAME = 'TadakSync2.exe'

/** zip에 넣을 문서 — src(소스) → dest(dist 안 파일명) */
const RELEASE_DOCS = [
  { src: path.join(APP_DIR, '사용법.txt'), dest: '사용법.txt', required: true },
  { src: path.join(APP_DIR, '사용법.md'), dest: '사용법.md', required: true },
]

function copyReleaseDocs() {
  let copied = 0
  for (const doc of RELEASE_DOCS) {
    if (!fs.existsSync(doc.src)) {
      if (doc.required) {
        console.error('필수 사용법 파일이 없습니다:', doc.src)
        console.error('tadaksync-v2/사용법.txt 를 만들거나 내용을 채워 주세요.')
        process.exit(1)
      }
      continue
    }
    const target = path.join(DIST_DIR, doc.dest)
    fs.copyFileSync(doc.src, target)
    console.log(`문서 복사: ${path.relative(ROOT, doc.src)} → dist/TadakSync2/${doc.dest}`)
    copied++
  }
  return copied
}

function createZip(srcDir, zipPath) {
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath)

  if (process.platform === 'win32') {
    const parent = path.dirname(srcDir)
    const folder = path.basename(srcDir)
    execSync(`tar.exe -a -cf "${zipPath}" -C "${parent}" "${folder}"`, { stdio: 'inherit' })
  } else {
    const parent = path.dirname(srcDir)
    const folder = path.basename(srcDir)
    execSync(`cd "${parent}" && zip -r -q "${zipPath}" "${folder}"`, { stdio: 'inherit', shell: true })
  }

  const mb = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1)
  console.log(`zip 생성 완료: ${path.relative(ROOT, zipPath)} (${mb} MB)`)
}

function findCachedModel() {
  const hub = process.env.HF_HOME
    ? path.join(process.env.HF_HOME, 'hub')
    : path.join(os.homedir(), '.cache', 'huggingface', 'hub')
  const repoDir = path.join(hub, 'models--Systran--faster-whisper-large-v3', 'snapshots')
  if (!fs.existsSync(repoDir)) return null
  for (const hash of fs.readdirSync(repoDir)) {
    const snap = path.join(repoDir, hash)
    if (fs.existsSync(path.join(snap, 'model.bin'))) return snap
  }
  return null
}

function copyModelInto(targetDir) {
  const snap = findCachedModel()
  if (!snap) {
    console.error('HF 캐시에서 large-v3 모델을 찾지 못했습니다.')
    console.error('프로그램에서 자막을 한 번 생성해 모델을 먼저 다운로드하세요.')
    process.exit(1)
  }
  const dest = path.join(targetDir, 'models', MODEL_NAME)
  fs.mkdirSync(dest, { recursive: true })
  let bytes = 0
  for (const f of fs.readdirSync(snap)) {
    const src = fs.realpathSync(path.join(snap, f))
    fs.copyFileSync(src, path.join(dest, f))
    bytes += fs.statSync(src).size
  }
  console.log(`모델 복사 완료: models/${MODEL_NAME} (${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB)`)
  return dest
}

function main() {
  const args = process.argv.slice(2)

  if (args.includes('--model-zip')) {
    const stage = path.join(APP_DIR, 'dist', 'models')
    fs.rmSync(stage, { recursive: true, force: true })
    copyModelInto(path.join(APP_DIR, 'dist'))
    createZip(stage, MODEL_ZIP_PATH)
    return
  }

  const exe = path.join(DIST_DIR, EXE_NAME)
  if (!fs.existsSync(DIST_DIR) || !fs.existsSync(exe)) {
    console.error('빌드 폴더가 없습니다:', DIST_DIR)
    console.error('먼저 PyInstaller로 dist/TadakSync2 을 빌드하세요.')
    console.error('(npm run build:subtitle-tool 또는 tadaksync-v2/README.md 참고)')
    process.exit(1)
  }

  const n = copyReleaseDocs()
  console.log(`문서 ${n}개 포함`)

  const modelDir = path.join(DIST_DIR, 'models')
  if (args.includes('--with-model')) {
    copyModelInto(DIST_DIR)
    createZip(DIST_DIR, FULL_ZIP_PATH)
  } else {
    fs.rmSync(modelDir, { recursive: true, force: true })
    createZip(DIST_DIR, ZIP_PATH)
  }
}

main()
