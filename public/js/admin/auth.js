/** Admin 인증 가드 */
;(function (global) {
  async function guardAdminAccess() {
    if (!global.API?.isLoggedIn?.()) {
      location.href = '/login.html?next=/admin.html'
      return false
    }
    try {
      const { allowed } = await API.get('/auth/admin-access')
      if (!allowed) {
        alert('관리자 접근 권한이 없는 계정입니다.')
        location.href = '/'
        return false
      }
      return true
    } catch {
      location.href = '/login.html?next=/admin.html'
      return false
    }
  }

  global.AdminAuth = { guardAdminAccess }
})(window)
