#!/usr/bin/env node
/** 타닥싱크2 개발 모드 — PyInstaller 없이 소스 실행 + 파일 감시 재시작 */
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

const appDir = path.join(__dirname, '../tadaksync-v2')
const pyWin = path.join(appDir, '.venv', 'Scripts', 'python.exe')
const pyUnix = path.join(appDir, '.venv', 'bin', 'python')
const python = fs.existsSync(pyWin) ? pyWin : pyUnix

if (!fs.existsSync(python)) {
  console.error('Python venv가 없습니다:', appDir)
  console.error('  cd tadaksync-v2')
  console.error('  py -3.12 -m venv .venv')
  console.error('  .\\.venv\\Scripts\\pip install -r requirements.txt')
  process.exit(1)
}

const env = {
  ...process.env,
  TADAKSYNC_DEV: '1',
  TADAKSYNC_DEBUG: '1',
}
if (!env.CAPCUT_SUBTITLE_API) {
  console.log('tip: 로컬 vcml 서버 사용 시 CAPCUT_SUBTITLE_API=http://localhost:3300')
}

console.log('npm run dev:subtitle-tool — dev_watch.py 시작\n')

const child = spawn(python, ['dev_watch.py'], {
  cwd: appDir,
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

child.on('exit', (code) => process.exit(code ?? 0))
