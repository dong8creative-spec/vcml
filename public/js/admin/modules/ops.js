/** Admin 클라이언츠·환불 모듈 */
;(function (global) {
  const esc = (...args) => (global.esc || global.AdminUtils?.esc || String)(...args)
  const fmtD = (...args) => (global.fmtD || global.AdminUtils?.fmtD || ((v) => v || '-'))(...args)

  async function loadRefunds() {
    const tbody = document.getElementById('refunds-table-body')
    const countEl = document.getElementById('refund-count')
    const badgeEl = document.getElementById('refund-badge')
    if (!tbody) return
    try {
      const orders = await API.get('/admin/orders')
      const refunds = orders.filter(o => o.status && o.status !== 'paid')
      if (countEl) countEl.textContent = refunds.length + '건'
      if (badgeEl) {
        badgeEl.textContent = refunds.length
        badgeEl.style.display = refunds.length ? '' : 'none'
      }
      if (!refunds.length) {
        tbody.innerHTML = '<tr class="empty-state-row"><td colspan="7">환불 내역이 없습니다.</td></tr>'
        return
      }
      const statusLabel = { refunded: '환불완료', cancelled: '취소' }
      tbody.innerHTML = refunds.map(o => `<tr>
          <td><div class="user-cell"><div class="avatar-sm">${esc((o.user_name || '?')[0])}</div> ${esc(o.user_name || '-')}</div></td>
          <td class="td-sub">${esc(o.course_title || '-')}</td>
          <td>${(o.amount || 0).toLocaleString()}원</td>
          <td>${o.refund_amount != null ? (o.refund_amount).toLocaleString() + '원' : '-'}</td>
          <td class="td-date">${fmtD(o.paid_at)}</td>
          <td class="td-date">${fmtD(o.refunded_at)}</td>
          <td><span class="badge-status refund">${statusLabel[o.status] || esc(o.status)}</span></td>
        </tr>`).join('')
    } catch (e) {
      if (tbody) tbody.innerHTML = `<tr class="empty-state-row"><td colspan="7">${esc(e.message || '불러오기 실패')}</td></tr>`
    }
  }

  async function loadProjects(status) {
    ;['open', 'matched', 'completed', 'all'].forEach(t => {
      const el = document.getElementById('ptab-' + t)
      if (el) el.classList.toggle('active', (status || 'all') === t)
    })
    const tbody = document.getElementById('projects-tbody')
    if (!tbody) return
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#aaa;padding:24px">로딩 중...</td></tr>'
    try {
      const qs = status ? `?status=${status}` : ''
      const projects = await API.get('/projects' + qs)
      if (!projects.length) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#aaa;padding:24px">클라이언츠가 없습니다.</td></tr>'
        return
      }
      const statusMap = {
        open: '<span class="status-tag done">모집중</span>',
        matched: '<span class="status-tag pending">매칭완료</span>',
        completed: '<span class="status-tag">완료</span>',
        cancelled: '<span class="status-tag refund">취소</span>',
      }
      tbody.innerHTML = projects.map(p => {
        const budget = p.budget_min || p.budget_max
          ? `${p.budget_min ? '₩' + Number(p.budget_min).toLocaleString() : ''}${p.budget_max ? '~₩' + Number(p.budget_max).toLocaleString() : ''}`
          : '협의'
        return `<tr>
            <td><a href="/project-detail.html?id=${p.id}" target="_blank" style="color:#111111">${p.title}</a></td>
            <td>${p.category}</td>
            <td>${p.client_name || '-'}</td>
            <td style="font-size: 14.4px">${budget}</td>
            <td style="text-align:center">${p.quote_count || 0}</td>
            <td class="td-date">${p.deadline || '-'}</td>
            <td class="td-date">${(p.created_at || '').slice(0, 10)}</td>
            <td>${statusMap[p.status] || p.status}</td>
            <td class="td-actions">
              ${p.status === 'open' ? `<button class="btn-sm-danger" onclick="cancelProject('${p.id}')">취소</button>` : ''}
            </td>
          </tr>`
      }).join('')
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="9" style="color:#e00;text-align:center;padding:24px">오류: ' + (e.message || '불러오기 실패') + '</td></tr>'
    }
  }

  async function cancelProject(id) {
    if (!confirm('이 클라이언츠를 취소하시겠습니까?')) return
    try {
      await API.patch('/projects/' + id + '/status', { status: 'cancelled' })
      loadProjects('open')
    } catch (e) {
      alert(e.message || '처리 중 오류')
    }
  }

  global.cancelProject = cancelProject
  global.AdminOps = { loadRefunds, loadProjects, cancelProject }

  if (global.AdminRouter) {
    global.AdminRouter.registerLoaders({
      refunds: loadRefunds,
      projects: () => loadProjects('open'),
    })
  }
})(window)
