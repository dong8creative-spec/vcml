;(function () {
  const FAB_ID = 'site-admin-fab'

  function isAdminPage() {
    return /\/admin\.html$/i.test(location.pathname)
  }

  async function canAccessAdmin() {
    if (!window.API?.isLoggedIn?.()) return false
    if (window.API.isAdmin?.()) return true
    try {
      const { allowed } = await window.API.get('/auth/admin-access')
      return !!allowed
    } catch {
      return false
    }
  }

  function removeFab() {
    document.getElementById(FAB_ID)?.remove()
  }

  function mountFab() {
    if (document.getElementById(FAB_ID) || isAdminPage()) return
    const iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 4v5c0 5-3.5 9-8 9s-8-4-8-9V7l8-4z"/><path d="M9 12l2 2 4-4"/></svg>'
    const link = document.createElement('a')
    link.id = FAB_ID
    link.href = '/admin.html'
    link.className = 'site-admin-fab'
    link.setAttribute('aria-label', '관리자 페이지로 이동')
    link.innerHTML = `<span class="site-admin-fab__icon" aria-hidden="true">${iconSvg}</span><span class="site-admin-fab__label">Admin</span>`
    document.body.appendChild(link)
  }

  async function syncAdminFab() {
    if (isAdminPage()) {
      removeFab()
      return
    }
    if (await canAccessAdmin()) mountFab()
    else removeFab()
  }

  window.syncAdminFab = syncAdminFab

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { syncAdminFab().catch(() => {}) })
  } else {
    syncAdminFab().catch(() => {})
  }

  document.addEventListener('site-header-ready', () => { syncAdminFab().catch(() => {}) })
})()
