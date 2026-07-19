#!/usr/bin/env node
/** 타닥싱크2 smoke test (GUI 없이 import·어절 분할 검증) */
const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const appDir = path.join(__dirname, '../tadaksync-v2')
const pyWin = path.join(appDir, '.venv', 'Scripts', 'python.exe')
const pyUnix = path.join(appDir, '.venv', 'bin', 'python')
const python = fs.existsSync(pyWin) ? pyWin : pyUnix

if (!fs.existsSync(python)) {
  console.error('Python venv가 없습니다:', appDir)
  process.exit(1)
}

execSync(`${JSON.stringify(python)} scripts/smoke_check.py`, {
  cwd: appDir,
  stdio: 'inherit',
  shell: true,
})
