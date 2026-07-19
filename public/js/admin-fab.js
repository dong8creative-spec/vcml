;(function () {
  const DOCK_ID = 'site-admin-dock'

  function isAdminToolPage() {
    return /\/(admin|ad-library)\.html$/i.test(location.pathname)
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

  function removeDock() {
    document.getElementById(DOCK_ID)?.remove()
  }

  function mountDock() {
    if (document.getElementById(DOCK_ID) || skipAdminFab()) return

    const dock = document.createElement('div')
    dock.id = DOCK_ID
    dock.className = 'site-admin-dock'
    dock.innerHTML = `
      <a href="/admin.html" class="site-admin-fab" aria-label="관리자 패널로 이동">
        <span class="site-admin-fab__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 4v5c0 5-3.5 9-8 9s-8-4-8-9V7l8-4z"/><path d="M9 12l2 2 4-4"/></svg>
        </span>
        <span class="site-admin-fab__label">Admin</span>
      </a>
      <a href="/ad-library.html" class="site-admin-fab site-admin-fab--ads" aria-label="Meta 광고 라이브러리로 이동">
        <span class="site-admin-fab__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M8 7h8"/><path d="M8 11h6"/></svg>
        </span>
        <span class="site-admin-fab__label">Ads</span>
      </a>
    `
    document.body.appendChild(dock)
  }

  function skipAdminFab() {
    if (isAdminToolPage()) return true
    if (window.self !== window.top) return true
    if (new URLSearchParams(location.search).get('preview') === '1') return true
    return false
  }

  async function syncAdminFab() {
    if (skipAdminFab()) {
      removeDock()
      return
    }
    if (await canAccessAdmin()) mountDock()
    else removeDock()
  }

  window.syncAdminFab = syncAdminFab

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { syncAdminFab().catch(() => {}) })
  } else {
    syncAdminFab().catch(() => {})
  }

  document.addEventListener('site-header-ready', () => { syncAdminFab().catch(() => {}) })
})()
