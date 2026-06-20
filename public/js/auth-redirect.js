// 공통 인증 복귀 헬퍼
// api.js 이후에 로드하거나 단독으로 사용 가능

function loginUrl(returnPath) {
  var path = (returnPath !== undefined)
    ? returnPath
    : (location.pathname + location.search)
  return '/login.html?next=' + encodeURIComponent(path)
}

function currentPath() {
  return location.pathname + location.search
}

// 로그인 필수 진입 보호 — false 반환 시 즉시 리다이렉트
function requireLogin(returnPath) {
  if (typeof API !== 'undefined' && !API.isLoggedIn()) {
    location.href = loginUrl(returnPath)
    return false
  }
  return true
}
