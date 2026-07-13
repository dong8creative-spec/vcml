(function () {

  const DEFAULT_FOOTER = {
    brand_name: '타닥클래스',
    tagline: '현업 전문가에게 배우는 실무 중심 영상 강의',
    columns: [
      { title: '강의', links: [
        { label: '전체 강의', href: '/courses' },
        { label: '캡컷 PRO', href: '/?cat=capcut#all' },
        { label: '강사 소개', href: '/instructor' },
        { label: '수강 후기', href: '/reviews' },
        { label: '블로그', href: '/blog' },
      ]},
      { title: '고객지원', links: [
        { label: '강의 기대평 남기기', href: '/#all' },
        { label: '1:1 문의하기', href: '/inquiry.html' },
        { label: '자주 묻는 질문', href: '/faq' },
        { label: '환불 및 취소 정책', href: '/policy/refund' },
      ]},
    ],
    policy_links: [
      { label: '공지사항', href: '/notices.html' },
      { label: '이용약관', href: '/policy/terms' },
      { label: '환불정책', href: '/policy/refund' },
      { label: '개인정보처리방침', href: '/policy/privacy', emphasis: true },
      { label: '청소년보호정책', href: '/youth.html' },
    ],
    biz_info: [
      '상호명 블루필드매뉴얼픽쳐스 · 대표자 이동헌 · 통신판매업신고 제 2025-부산진-0959 호',
      '사업자등록번호 640-50-00860 · 고객센터 010-4850-6946',
      '주소 부산광역시 부산진구 가야대로 707-2(당감동) · 이메일 dong8creative@gmail.com',
    ],
    copyright: '© 2025 타닥클래스. All rights reserved.',
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  function renderFooter(cfg) {
    const c = cfg || DEFAULT_FOOTER
    const columns = (c.columns || []).map(col => `
      <div>
        <div class="footer-col-title">${esc(col.title)}</div>
        <ul>${(col.links || []).map(link => {
          const style = link.emphasis ? ' style="font-weight:700"' : ''
          return `<li><a href="${esc(link.href)}"${style}>${esc(link.label)}</a></li>`
        }).join('')}</ul>
      </div>`).join('')

    const policies = (c.policy_links || []).map(p =>
      `<a href="${esc(p.href)}">${esc(p.label)}</a>`
    ).join('')

    return `<footer class="footer">
  <div class="container">
    <div class="footer-grid">
      <div class="footer-brand">
        <a href="/" class="logo footer-logo">${esc(c.brand_name)}</a>
        <div class="footer-tagline footer-tagline--lead">${esc(c.tagline)}</div>
      </div>
      ${columns}
    </div>
    <div class="biz-info">
      <button type="button" class="biz-toggle" onclick="this.closest('.biz-info').classList.toggle('open')">
        사업자 정보 <i class="ti ti-chevron-down"></i>
      </button>
      <div class="biz-detail">${Array.isArray(c.biz_info) ? c.biz_info.map(line => `<p>${esc(line)}</p>`).join('') : `<p>${esc(c.biz_info)}</p>`}</div>
    </div>
    <div class="footer-bottom">
      <span>${esc(c.copyright)}</span>
      <div class="footer-policy">${policies}</div>
    </div>
  </div>
</footer>`
  }

  async function fetchFooterConfig() {
    try {
      const res = await fetch('/api/footer')
      if (res.ok) return await res.json()
    } catch (_) { /* fallback */ }
    return DEFAULT_FOOTER
  }

  async function mountFooter() {
    const footerEl = document.querySelector('[data-chrome="footer"]')
    if (!footerEl) return
    const cfg = await fetchFooterConfig()
    footerEl.outerHTML = renderFooter(cfg)
  }

  window.renderSiteFooter = renderFooter
  window.fetchSiteFooterConfig = fetchFooterConfig

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountFooter)
  } else {
    mountFooter()
  }
})()
