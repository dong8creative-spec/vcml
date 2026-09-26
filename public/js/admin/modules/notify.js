/** Admin 알림 발송 모듈: 강의 개설 / 타닥싱크 업데이트 카카오 알림톡 트리거 */
;(function (global) {
  let _coursesLoaded = false

  async function loadNotifyCourseOptions() {
    if (_coursesLoaded) return
    const select = document.getElementById('notify-course-select')
    if (!select) return
    try {
      const courses = await API.get('/admin/courses')
      select.innerHTML = courses.map(c => `<option value="${c.id}">${(c.title || '').replace(/</g, '&lt;')}</option>`).join('')
      _coursesLoaded = true
    } catch (e) {
      select.innerHTML = '<option value="">강의 목록을 불러오지 못했습니다.</option>'
    }
  }

  function bindNotifyEvents() {
    document.getElementById('notify-course-btn')?.addEventListener('click', async () => {
      const courseId = document.getElementById('notify-course-select').value
      if (!courseId) return alert('강의를 선택하세요.')
      if (!confirm('마케팅 수신 동의 회원 전체에게 개설 알림을 보낼까요?')) return
      try {
        const result = await API.post('/admin/courses/' + courseId + '/notify-new-course', {})
        alert(`발송 완료: ${result.sent}건 성공, ${result.failed}건 실패`)
      } catch (e) {
        alert(e.message || '발송 실패')
      }
    })

    document.getElementById('notify-ts-btn')?.addEventListener('click', async () => {
      const version = document.getElementById('notify-ts-version').value.trim()
      const notes = document.getElementById('notify-ts-notes').value.trim()
      const download_url = document.getElementById('notify-ts-url').value.trim()
      if (!version || !download_url) return alert('버전과 다운로드 링크는 필수입니다.')
      if (!confirm('마케팅 수신 동의 회원 전체에게 업데이트 알림을 보낼까요?')) return
      try {
        const result = await API.post('/admin/tadaksync/notify-update', { version, notes, download_url })
        alert(`발송 완료: ${result.sent}건 성공, ${result.failed}건 실패`)
      } catch (e) {
        alert(e.message || '발송 실패')
      }
    })
  }

  // 'settings' 섹션 로더는 admin.html 인라인 스크립트가 이미 등록(loadSettings)하므로 여기서 덮어쓰지 않는다.
  // 대신 부팅 시 한 번 바로 강의 목록을 채워둔다(셀렉트는 설정 탭을 열기 전까지는 화면에 안 보이므로 안전).
  function init() {
    bindNotifyEvents()
    loadNotifyCourseOptions()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})(window)
