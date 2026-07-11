#!/usr/bin/env node
/**
 * 타닥싱크(TadakSync) 배포 zip 패키징
 *
 * 1) capcut subtitle/dist/TadakSync 에 사용법 등 문서 복사
 * 2) TadakSync.zip 생성
 *
 * 사용법 파일 위치 (이 파일들을 수정하면 zip에 반영됨):
 *   capcut subtitle/사용법.txt   ← 수강생용 (필수)
 *   capcut subtitle/사용법.md    ← 수강생용 (필수, txt와 동기화)
 *
 * 사용:
 *   node scripts/package-subtitle-tool.js               # 경량 zip (모델 미포함, 첫 실행 시 자동 다운로드)
 *   node scripts/package-subtitle-tool.js --with-model  # 풀버전 zip (~3.2GB, Whisper 모델 동봉)
 *   node scripts/package-subtitle-tool.js --model-zip   # 모델 단독 zip (자동 다운로드 실패 사용자용)
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const CAPCUT_DIR = path.join(ROOT, 'capcut subtitle')
const DIST_DIR = path.join(CAPCUT_DIR, 'dist', 'TadakSync')
const ZIP_PATH = path.join(CAPCUT_DIR, 'dist', 'TadakSync.zip')
const FULL_ZIP_PATH = path.join(CAPCUT_DIR, 'dist', 'TadakSync-full.zip')
const MODEL_ZIP_PATH = path.join(CAPCUT_DIR, 'dist', 'whisper-model-large-v3.zip')
const MODEL_NAME = 'faster-whisper-large-v3'

/** zip에 넣을 문서 — src(소스) → dest(dist 안 파일명) */
const RELEASE_DOCS = [
  { src: path.join(CAPCUT_DIR, '사용법.txt'), dest: '사용법.txt', required: true },
  { src: path.join(CAPCUT_DIR, '사용법.md'), dest: '사용법.md', required: true },
  { src: path.join(CAPCUT_DIR, '도각 자막패치 사용법 v1.0.0.pdf'), dest: '타닥싱크 사용법.pdf', required: false },
  { src: path.join(CAPCUT_DIR, '타닥싱크 사용법.pdf'), dest: '타닥싱크 사용법.pdf', required: false },
]

function copyReleaseDocs() {
  let copied = 0
  for (const doc of RELEASE_DOCS) {
    if (!fs.existsSync(doc.src)) {
      if (doc.required) {
        console.error('필수 사용법 파일이 없습니다:', doc.src)
        console.error('capcut subtitle/사용법.txt 를 만들거나 내용을 채워 주세요.')
        process.exit(1)
      }
      continue
    }
    const target = path.join(DIST_DIR, doc.dest)
    fs.copyFileSync(doc.src, target)
    console.log(`문서 복사: ${path.relative(ROOT, doc.src)} → dist/TadakSync/${doc.dest}`)
    copied++
  }
  return copied
}

function createZip(srcDir, zipPath) {
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath)

  if (process.platform === 'win32') {
    // Compress-Archive는 2GB 초과 파일에서 실패("Stream was too long")하므로
    // Windows 내장 bsdtar(zip64 지원)를 사용한다
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

/** HF 캐시에서 다운로드된 large-v3 모델 스냅샷 폴더를 찾는다. */
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

/** 모델 스냅샷을 targetDir/models/faster-whisper-large-v3 로 복사(심볼릭 링크는 실체로). */
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
    const src = fs.realpathSync(path.join(snap, f)) // HF 캐시는 blob 심볼릭 링크 구조
    fs.copyFileSync(src, path.join(dest, f))
    bytes += fs.statSync(src).size
  }
  console.log(`모델 복사 완료: models/${MODEL_NAME} (${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB)`)
  return dest
}

function main() {
  const args = process.argv.slice(2)

  if (args.includes('--model-zip')) {
    // 모델 단독 zip: 자동 다운로드가 안 되는 사용자가 받아서
    // 프로그램 폴더의 models\faster-whisper-large-v3 에 풀어 쓰는 용도
    const stage = path.join(CAPCUT_DIR, 'dist', 'models')
    fs.rmSync(stage, { recursive: true, force: true })
    copyModelInto(path.join(CAPCUT_DIR, 'dist'))
    createZip(stage, MODEL_ZIP_PATH)
    return
  }

  const exe = path.join(DIST_DIR, 'TadakSync.exe')
  if (!fs.existsSync(DIST_DIR) || !fs.existsSync(exe)) {
    console.error('빌드 폴더가 없습니다:', DIST_DIR)
    console.error('먼저 PyInstaller로 dist/TadakSync 을 빌드하세요.')
    console.error('(capcut subtitle/README.md 의 배포판 빌드 참고)')
    process.exit(1)
  }

  const n = copyReleaseDocs()
  console.log(`문서 ${n}개 포함`)

  const modelDir = path.join(DIST_DIR, 'models')
  if (args.includes('--with-model')) {
    copyModelInto(DIST_DIR)
    createZip(DIST_DIR, FULL_ZIP_PATH)
  } else {
    // 경량 zip에는 모델이 들어가지 않도록 제거
    fs.rmSync(modelDir, { recursive: true, force: true })
    createZip(DIST_DIR, ZIP_PATH)
  }
}

main()
