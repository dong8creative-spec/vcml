#!/usr/bin/env node
/** PyInstaller로 dist/TadakSync2 재빌드 (타닥싱크 2) */
const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const appDir = path.join(__dirname, '../tadaksync-v2')
const py = path.join(appDir, '.venv', 'Scripts', 'python.exe')
const pyUnix = path.join(appDir, '.venv', 'bin', 'python')
const python = fs.existsSync(py) ? py : pyUnix

if (!fs.existsSync(python)) {
  console.error('Python venv가 없습니다:', appDir)
  console.error('tadaksync-v2 에서 py -3.12 -m venv .venv 후 requirements 설치하세요.')
  process.exit(1)
}

execSync(`${JSON.stringify(python)} -m PyInstaller --noconfirm --clean TadakSync2.spec`, {
  cwd: appDir,
  stdio: 'inherit',
  shell: true,
})
