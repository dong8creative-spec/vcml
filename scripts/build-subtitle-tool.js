#!/usr/bin/env node
/** PyInstaller로 dist/TadakSync 재빌드 */
const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const capcutDir = path.join(__dirname, '../capcut subtitle')
const py = path.join(capcutDir, '.venv', 'Scripts', 'python.exe')
const pyUnix = path.join(capcutDir, '.venv', 'bin', 'python')
const python = fs.existsSync(py) ? py : pyUnix

if (!fs.existsSync(python)) {
  console.error('Python venv가 없습니다:', capcutDir)
  process.exit(1)
}

execSync(`${JSON.stringify(python)} -m PyInstaller --noconfirm --clean TadakSync.spec`, {
  cwd: capcutDir,
  stdio: 'inherit',
  shell: true,
})
