/** 선물코드 이벤트 관리 — 강의별 대량 코드 발급 및 사용 현황 */
;(function (global) {
  let coursesCache = null
  let lastGenerated = []

  function $(id) {
    return document.getElementById(id)
  }

  async function ensureCourses() {
    if (coursesCache) return coursesCache
    coursesCache = await API.get('/admin/courses')
    return coursesCache
  }

  function fillCourseSelects(courses) {
    const opts = courses.map(c => `<option value="${c.id}">${esc(c.title)}</option>`).join('')
    const genSel = $('gc-course-select')
    if (genSel && !genSel.dataset.filled) {
      genSel.innerHTML = opts
      genSel.dataset.filled = '1'
    }
    const filterSel = $('gc-filter-course')
    if (filterSel && !filterSel.dataset.filled) {
      filterSel.insertAdjacentHTML('beforeend', opts)
      filterSel.dataset.filled = '1'
    }
    const eventSel = $('ge-course-select')
    if (eventSel && !eventSel.dataset.filled) {
      eventSel.innerHTML = opts
      eventSel.dataset.filled = '1'
    }
  }

  const STATUS_LABEL = {
    available: '미사용',
    reserved: '예약중',
    redeemed: '사용완료',
    expired: '만료',
    inactive: '비활성',
  }
  const STATUS_COLOR = {
    available: '#888',
    reserved: '#e08e0b',
    redeemed: '#16a34a',
    expired: '#e74c3c',
    inactive: '#aaa',
  }

  function statusBadge(status) {
    const label = STATUS_LABEL[status] || status
    const color = STATUS_COLOR[status] || '#888'
    return `<span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700;color:#fff;background:${color}">${label}</span>`
  }

  function fmt(iso) {
    if (!iso) return '-'
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('ko-KR')
  }

  async function loadGiftCodes() {
    try {
      const courses = await ensureCourses()
      fillCourseSelects(courses)
    } catch (e) {
      console.error('강의 목록 로드 실패:', e.message)
    }
    await geLoadConfig()
    await gcLoadList()
  }

  async function geLoadConfig() {
    const summaryEl = $('ge-summary')
    try {
      const config = await API.get('/admin/gift-event')
      if ($('ge-quota')) $('ge-quota').value = config.quota || 20
      if ($('ge-duration')) $('ge-duration').value = config.duration_days || 21
      if ($('ge-active')) $('ge-active').checked = !!config.active
      const sel = $('ge-course-select')
      if (sel && config.course_id) sel.value = config.course_id
      if (summaryEl) {
        summaryEl.textContent = config.course_id
          ? `현재 상태: ${config.active ? '활성화됨' : '비활성화됨'} · ${config.issued_count}/${config.quota}명 발급됨 (${config.course_title || '-'})`
          : '아직 이벤트가 설정되지 않았습니다.'
      }
    } catch (e) {
      if (summaryEl) summaryEl.textContent = '설정을 불러오지 못했습니다: ' + e.message
    }
  }

  async function geSaveConfig() {
    const statusEl = $('ge-status')
    const btn = $('ge-save-btn')
    const course_id = $('ge-course-select')?.value
    const quota = $('ge-quota')?.value
    const duration_days = $('ge-duration')?.value
    const active = $('ge-active')?.checked
    if (statusEl) { statusEl.style.color = '#e74c3c'; statusEl.textContent = '' }
    if (active && !course_id) {
      if (statusEl) statusEl.textContent = '강의를 선택하세요.'
      return
    }
    btn.disabled = true
    btn.textContent = '저장 중...'
    try {
      await API.patch('/admin/gift-event', { course_id, quota, duration_days, active })
      if (statusEl) { statusEl.style.color = '#16a34a'; statusEl.textContent = '저장되었습니다.' }
      await geLoadConfig()
    } catch (e) {
      if (statusEl) statusEl.textContent = e.message || '저장 실패'
    } finally {
      btn.disabled = false
      btn.textContent = '저장'
    }
  }

  async function gcLoadList() {
    const el = $('gc-codes-table')
    if (!el) return
    el.innerHTML = '<div style="text-align:center;padding:40px;color:#aaa;font-size:14px">불러오는 중...</div>'
    try {
      const course_id = $('gc-filter-course')?.value || ''
      const status = $('gc-filter-status')?.value || ''
      const params = new URLSearchParams()
      if (course_id) params.set('course_id', course_id)
      if (status) params.set('status', status)
      const qs = params.toString()
      const codes = await API.get('/admin/gift-codes' + (qs ? '?' + qs : ''))
      if (!codes.length) {
        el.innerHTML = '<div style="text-align:center;padding:40px;color:#aaa;font-size:14px">발급된 코드가 없습니다.</div>'
        return
      }
      el.innerHTML = `<table class="data-table">
        <thead><tr><th>코드</th><th>강의</th><th>상태</th><th>예약자/확정</th><th>마감시각</th><th>메모</th><th></th></tr></thead>
        <tbody>${codes.map(c => `<tr>
          <td><code style="font-size:14px;font-weight:700;letter-spacing:1px">${esc(c.code)}</code></td>
          <td style="font-size:13px">${esc(c.course_title || '-')}</td>
          <td>${statusBadge(c.effective_status)}</td>
          <td style="font-size:12px;color:#888">${c.redeemed_at ? '확정 ' + fmt(c.redeemed_at) : (c.reserved_at ? '예약 ' + fmt(c.reserved_at) : '-')}</td>
          <td style="font-size:12px;color:#888">${c.review_deadline ? fmt(c.review_deadline) : '-'}</td>
          <td style="font-size:12px;color:#888">${esc(c.note || '-')}</td>
          <td>${c.effective_status === 'redeemed' ? '' : `<button onclick="gcDeleteCode('${c.id}')" style="padding:5px 10px;border:1px solid #ddd;border-radius:6px;background:#fff;font-size:12px;color:#e74c3c;cursor:pointer">삭제</button>`}</td>
        </tr>`).join('')}</tbody>
      </table>`
    } catch (e) {
      el.innerHTML = `<div style="text-align:center;padding:40px;color:#e74c3c;font-size:14px">오류: ${e.message}</div>`
    }
  }

  async function gcGenerate() {
    const statusEl = $('gc-generate-status')
    const btn = $('gc-generate-btn')
    const course_id = $('gc-course-select')?.value
    const count = $('gc-count')?.value
    const duration_days = $('gc-duration')?.value
    const note = $('gc-note')?.value.trim()
    if (statusEl) statusEl.textContent = ''
    if (!course_id) { if (statusEl) statusEl.textContent = '강의를 선택하세요.'; return }
    btn.disabled = true
    btn.textContent = '발급 중...'
    try {
      const result = await API.post('/admin/gift-codes/generate', { course_id, count, duration_days, note })
      lastGenerated = result.codes || []
      const resultBox = $('gc-generate-result')
      $('gc-generate-count').textContent = lastGenerated.length
      $('gc-generate-list').innerHTML = lastGenerated.map(c => `<span style="background:#fff;border:1px solid #e0e0e0;border-radius:6px;padding:4px 10px">${esc(c.code)}</span>`).join('')
      resultBox.style.display = ''
      await gcLoadList()
    } catch (e) {
      if (statusEl) statusEl.textContent = e.message || '발급 실패'
    } finally {
      btn.disabled = false
      btn.textContent = '발급'
    }
  }

  function gcCopyGenerated() {
    if (!lastGenerated.length) return
    const text = lastGenerated.map(c => c.code).join('\n')
    navigator.clipboard?.writeText(text)
  }

  function gcDownloadCsv() {
    if (!lastGenerated.length) return
    const courseTitle = $('gc-course-select')?.selectedOptions?.[0]?.textContent || ''
    const rows = [['code', 'course_title', 'duration_days'], ...lastGenerated.map(c => [c.code, courseTitle, c.duration_days])]
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'gift-codes.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function gcDeleteCode(id) {
    if (!confirm('이 코드를 삭제하시겠습니까?')) return
    try {
      await API.del('/admin/gift-codes/' + id)
      await gcLoadList()
    } catch (e) {
      alert(e.message || '삭제 실패')
    }
  }

  global.loadGiftCodes = loadGiftCodes
  global.geLoadConfig = geLoadConfig
  global.geSaveConfig = geSaveConfig
  global.gcLoadList = gcLoadList
  global.gcGenerate = gcGenerate
  global.gcCopyGenerated = gcCopyGenerated
  global.gcDownloadCsv = gcDownloadCsv
  global.gcDeleteCode = gcDeleteCode
})(window)
