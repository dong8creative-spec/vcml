/** 메인 히어로 버튼 — 사이트 페이지/기능 연동 */
;(function (global) {
  const HERO_BUTTON_ACTIONS = [
    { id: 'all_courses', label: '전체 강의 보기', href: '#all' },
    { id: 'instructors', label: '강사 소개', href: '/instructor' },
    { id: 'reviews', label: '수강 후기', href: '/reviews' },
    { id: 'blog', label: '블로그', href: '/blog' },
    { id: 'capcut', label: '캡컷 PRO 강의', href: '/?cat=capcut#all' },
    { id: 'editors', label: '에디터즈', href: '/editors.html' },
    { id: 'editor_apply', label: '에디터즈 신청', href: '/editor-program.html' },
    { id: 'projects', label: '클라이언츠', href: '/projects.html' },
    { id: 'mypage', label: '마이페이지', href: '/mypage.html' },
    { id: 'login', label: '로그인', href: '/login.html' },
    { id: 'faq', label: 'FAQ', href: '/faq' },
    { id: 'support', label: '고객지원', href: '/support.html' },
    { id: 'custom', label: '직접 입력 (URL)', href: '', custom: true },
  ]

  function buildHeroCourseActions(courses) {
    return (courses || [])
      .filter(c => c && c.is_published && c.slug)
      .sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999))
      .map(c => ({
        id: `course:${c.slug}`,
        label: `강의 · ${c.title}`,
        href: `/courses/${encodeURIComponent(c.slug)}`,
        group: 'course',
      }))
  }

  function getAllHeroActions(extraActions) {
    return [...HERO_BUTTON_ACTIONS, ...(extraActions || [])]
  }

  function findHeroAction(actionId, extraActions) {
    return getAllHeroActions(extraActions).find(a => a.id === actionId) || null
  }

  function inferHeroAction(href, extraActions) {
    const url = String(href || '').trim()
    if (!url) return 'all_courses'
    const hit = getAllHeroActions(extraActions).find(a => !a.custom && a.href === url)
    return hit ? hit.id : 'custom'
  }

  function resolveHeroButton(btn, extraActions) {
    const base = btn && typeof btn === 'object' ? { ...btn } : {}
    const actionDef = base.action ? findHeroAction(base.action, extraActions) : null
    if (actionDef && !actionDef.custom) {
      return {
        ...base,
        href: actionDef.href,
        defaultLabel: actionDef.label,
        label: String(base.label || '').trim() || actionDef.label,
      }
    }
    const href = String(base.href || '#all').trim() || '#all'
    const fallback = findHeroAction(inferHeroAction(href, extraActions), extraActions)
    return {
      ...base,
      href,
      defaultLabel: fallback?.label || '',
      label: String(base.label || '').trim() || fallback?.label || '',
    }
  }

  global.HERO_BUTTON_ACTIONS = HERO_BUTTON_ACTIONS
  global.buildHeroCourseActions = buildHeroCourseActions
  global.getAllHeroActions = getAllHeroActions
  global.findHeroAction = findHeroAction
  global.inferHeroAction = inferHeroAction
  global.resolveHeroButton = resolveHeroButton
})(typeof window !== 'undefined' ? window : globalThis)
