#!/usr/bin/env node
/**
 * 도각 자막패치 배포 zip 패키징
 *
 * 1) capcut subtitle/dist/CapCutSubtitle 에 사용법 등 문서 복사
 * 2) CapCutSubtitle.zip 생성
 *
 * 사용법 파일 위치 (이 파일들을 수정하면 zip에 반영됨):
 *   capcut subtitle/사용법.txt   ← 수강생용 (필수)
 *   capcut subtitle/사용법.md    ← 있으면 함께 포함
 *
 * 사용: node scripts/package-subtitle-tool.js
 */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const CAPCUT_DIR = path.join(ROOT, 'capcut subtitle')
const DIST_DIR = path.join(CAPCUT_DIR, 'dist', 'CapCutSubtitle')
const ZIP_PATH = path.join(CAPCUT_DIR, 'dist', 'CapCutSubtitle.zip')

/** zip에 넣을 문서 — src(소스) → dest(dist 안 파일명) */
const RELEASE_DOCS = [
  { src: path.join(CAPCUT_DIR, '사용법.txt'), dest: '사용법.txt', required: true },
  { src: path.join(CAPCUT_DIR, '사용법.md'), dest: '사용법.md', required: false },
  { src: path.join(CAPCUT_DIR, '도각 자막패치 사용법 v1.0.0.pdf'), dest: '도각 자막패치 사용법 v1.0.0.pdf', required: false },
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
    console.log(`문서 복사: ${path.relative(ROOT, doc.src)} → dist/CapCutSubtitle/${doc.dest}`)
    copied++
  }
  return copied
}

function createZip() {
  if (fs.existsSync(ZIP_PATH)) fs.unlinkSync(ZIP_PATH)

  if (process.platform === 'win32') {
    const distEsc = DIST_DIR.replace(/'/g, "''")
    const zipEsc = ZIP_PATH.replace(/'/g, "''")
    execSync(
      `powershell -NoProfile -Command "Compress-Archive -LiteralPath '${distEsc}' -DestinationPath '${zipEsc}' -CompressionLevel Optimal"`,
      { stdio: 'inherit' }
    )
  } else {
    const parent = path.dirname(DIST_DIR)
    const folder = path.basename(DIST_DIR)
    execSync(`cd "${parent}" && zip -r -q "${ZIP_PATH}" "${folder}"`, { stdio: 'inherit', shell: true })
  }

  const mb = (fs.statSync(ZIP_PATH).size / 1024 / 1024).toFixed(1)
  console.log(`zip 생성 완료: ${path.relative(ROOT, ZIP_PATH)} (${mb} MB)`)
}

function main() {
  const exe = path.join(DIST_DIR, 'CapCutSubtitle.exe')
  if (!fs.existsSync(DIST_DIR) || !fs.existsSync(exe)) {
    console.error('빌드 폴더가 없습니다:', DIST_DIR)
    console.error('먼저 PyInstaller로 dist/CapCutSubtitle 을 빌드하세요.')
    console.error('(capcut subtitle/README.md 의 배포판 빌드 참고)')
    process.exit(1)
  }

  const n = copyReleaseDocs()
  console.log(`문서 ${n}개 포함`)
  createZip()
}

main()
