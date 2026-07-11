/** Admin 지원 모듈: 공지·문의·FAQ */
;(function (global) {
  const esc = (...args) => (global.esc || global.AdminUtils?.esc || String)(...args)

  let _noticeEditId = null
  let _ticketId = null
  let _faqEditId = null

  async function loadNotices() {
    const tbody = document.getElementById('notices-tbody')
    if (!tbody) return
    try {
      const notices = await API.get('/admin/notices')
      if (!notices.length) {
        tbody.innerHTML = '<tr class="empty-state-row"><td colspan="5">등록된 공지가 없습니다.</td></tr>'
        return
      }
      tbody.innerHTML = notices.map(n => `
          <tr>
            <td>${n.is_pinned ? '<span class="status-tag done">고정</span>' : '-'}</td>
            <td><strong style="font-size:14px">${esc(n.title)}</strong></td>
            <td><span class="status-tag ${n.is_public ? 'done' : 'draft'}">${n.is_public ? '공개' : '비공개'}</span></td>
            <td class="td-date">${(n.created_at || '').slice(0, 10)}</td>
            <td class="td-actions">
              <button class="btn-sm" onclick="openNoticeEdit('${n.id}')">편집</button>
              <button class="btn-sm-danger" onclick="deleteNotice('${n.id}')">삭제</button>
            </td>
          </tr>`).join('')
    } catch (e) {
      tbody.innerHTML = `<tr class="empty-state-row"><td colspan="5">${e.message}</td></tr>`
    }
  }

  function openNoticeModal(n) {
    _noticeEditId = n ? n.id : null
    document.getElementById('notice-modal-title').textContent = n ? '공지 편집' : '새 공지 작성'
    document.getElementById('nm-title').value = n ? n.title : ''
    document.getElementById('nm-content').value = n ? n.content : ''
    document.getElementById('nm-public').checked = n ? !!n.is_public : false
    document.getElementById('nm-pin').checked = n ? !!n.is_pinned : false
    document.getElementById('notice-modal').style.display = 'flex'
  }

  async function loadTickets(status) {
    ;['open', 'answered', 'closed', 'all'].forEach(t => {
      const el = document.getElementById('ttab-' + t)
      if (el) el.classList.toggle('active', (status || 'open') === t)
    })
    const tbody = document.getElementById('tickets-tbody')
    if (!tbody) return
    tbody.innerHTML = '<tr class="empty-state-row"><td colspan="7">불러오는 중...</td></tr>'
    try {
      const qs = (status && status !== 'all') ? `?status=${status}` : ''
      const tickets = await API.get('/admin/tickets' + qs)
      if (!tickets.length) {
        tbody.innerHTML = '<tr class="empty-state-row"><td colspan="7">문의가 없습니다.</td></tr>'
        return
      }
      const smap = { open: '미답변', answered: '답변완료', closed: '종료' }
      const scls = { open: 'pending', answered: 'answered', closed: 'draft' }
      global.seqSet('ticket', tickets, -1, item => openTicket(item.id || item))
      tbody.innerHTML = tickets.map((t, i) => `
          <tr class="ticket-row" onclick="openTicketSeq(${i})">
            <td><span class="pill ${scls[t.status] || 'pending'}">${t.type || '일반'}</span></td>
            <td>
              <div class="ticket-subject">${esc(t.subject)}</div>
              <div class="ticket-preview">${esc(t.content)}</div>
            </td>
            <td>${esc(t.name)}</td>
            <td class="td-date">${esc(t.email)}</td>
            <td><span class="status-tag ${scls[t.status] || 'pending'}">${smap[t.status] || t.status}</span></td>
            <td class="td-date">${(t.created_at || '').slice(0, 10)}</td>
            <td class="td-actions">
              <button class="btn-sm-danger" onclick="event.stopPropagation();deleteTicket('${t.id}')">삭제</button>
            </td>
          </tr>`).join('')
    } catch (e) {
      tbody.innerHTML = `<tr class="empty-state-row"><td colspan="7">${e.message}</td></tr>`
    }
  }

  async function openTicket(id) {
    _ticketId = id
    global.seqUpdateNav('ticket')
    try {
      const t = await API.get('/admin/tickets/' + id)
      document.getElementById('ticket-modal-title').textContent = `문의 — ${esc(t.subject)}`
      document.getElementById('ticket-answer-input').value = t.answer || ''
      document.getElementById('ticket-modal-body').innerHTML = `
          <div class="review-panel">
            <p><strong>이름:</strong> ${esc(t.name)} &nbsp;·&nbsp; <strong>이메일:</strong> ${esc(t.email)}</p>
            <p><strong>유형:</strong> ${esc(t.type || '일반')} &nbsp;·&nbsp; <strong>접수:</strong> ${(t.created_at || '').slice(0, 16).replace('T', ' ')}</p>
          </div>
          <p style="font-size:15px;line-height:1.8;margin-top:8px;white-space:pre-line">${esc(t.content)}</p>
          ${t.answer ? `<div class="review-panel" style="margin-top:16px;border-left:3px solid var(--primary)"><strong>이전 답변</strong><br>${esc(t.answer)}</div>` : ''}`
      document.getElementById('ticket-modal').style.display = 'flex'
    } catch (e) {
      alert(e.message)
    }
  }

  async function loadFaqs() {
    const tbody = document.getElementById('faqs-tbody')
    if (!tbody) return
    try {
      const faqs = await API.get('/admin/faqs')
      if (!faqs.length) {
        tbody.innerHTML = '<tr class="empty-state-row"><td colspan="5">등록된 FAQ가 없습니다.</td></tr>'
        return
      }
      tbody.innerHTML = faqs.map(f => `
          <tr>
            <td class="td-date">${f.sort_order ?? '-'}</td>
            <td><span class="pill pending">${esc(f.category || '일반')}</span></td>
            <td style="max-width:320px"><div style="font-size:14px;font-weight:600">${esc(f.question)}</div><div class="td-sub" style="margin-top:3px">${esc(f.answer).slice(0, 60)}...</div></td>
            <td><span class="status-tag ${f.is_public ? 'done' : 'draft'}">${f.is_public ? '공개' : '비공개'}</span></td>
            <td class="td-actions">
              <button class="btn-sm" onclick="openFaqEdit('${f.id}')">편집</button>
              <button class="btn-sm-danger" onclick="deleteFaq('${f.id}')">삭제</button>
            </td>
          </tr>`).join('')
    } catch (e) {
      tbody.innerHTML = `<tr class="empty-state-row"><td colspan="5">${e.message}</td></tr>`
    }
  }

  function openFaqModal(f) {
    _faqEditId = f ? f.id : null
    document.getElementById('faq-modal-title').textContent = f ? 'FAQ 편집' : 'FAQ 추가'
    document.getElementById('fm-category').value = f ? (f.category || '일반') : '일반'
    document.getElementById('fm-question').value = f ? f.question : ''
    document.getElementById('fm-answer').value = f ? f.answer : ''
    document.getElementById('fm-order').value = f ? (f.sort_order ?? '') : ''
    document.getElementById('fm-public').checked = f ? !!f.is_public : true
    document.getElementById('faq-modal').style.display = 'flex'
  }

  function bindSupportEvents() {
    document.getElementById('notice-create-btn')?.addEventListener('click', () => openNoticeModal(null))
    document.getElementById('nm-save')?.addEventListener('click', async () => {
      const title = document.getElementById('nm-title').value.trim()
      const content = document.getElementById('nm-content').value.trim()
      if (!title || !content) return alert('제목과 내용을 입력하세요.')
      const body = {
        title,
        content,
        is_public: document.getElementById('nm-public').checked,
        is_pinned: document.getElementById('nm-pin').checked,
      }
      if (_noticeEditId) await API.patch('/admin/notices/' + _noticeEditId, body)
      else await API.post('/admin/notices', body)
      document.getElementById('notice-modal').style.display = 'none'
      loadNotices()
    })

    document.getElementById('ticket-answer-btn')?.addEventListener('click', async () => {
      if (!_ticketId) return
      const answer = document.getElementById('ticket-answer-input').value.trim()
      if (!answer) return alert('답변 내용을 입력하세요.')
      await API.post('/admin/tickets/' + _ticketId + '/answer', { answer })
      document.getElementById('ticket-modal').style.display = 'none'
      loadTickets('open')
    })
    document.getElementById('ticket-close-btn')?.addEventListener('click', async () => {
      if (!_ticketId || !confirm('이 문의를 종료 처리하시겠습니까?')) return
      await API.patch('/admin/tickets/' + _ticketId + '/status', { status: 'closed' })
      document.getElementById('ticket-modal').style.display = 'none'
      loadTickets('open')
    })

    document.getElementById('faq-create-btn')?.addEventListener('click', () => openFaqModal(null))
    document.getElementById('fm-save')?.addEventListener('click', async () => {
      const question = document.getElementById('fm-question').value.trim()
      const answer = document.getElementById('fm-answer').value.trim()
      if (!question || !answer) return alert('질문과 답변을 입력하세요.')
      const body = {
        question,
        answer,
        category: document.getElementById('fm-category').value,
        is_public: document.getElementById('fm-public').checked,
        sort_order: parseInt(document.getElementById('fm-order').value, 10) || undefined,
      }
      if (_faqEditId) await API.patch('/admin/faqs/' + _faqEditId, body)
      else await API.post('/admin/faqs', body)
      document.getElementById('faq-modal').style.display = 'none'
      loadFaqs()
    })
  }

  global.openNoticeEdit = async (id) => {
    const n = await API.get('/admin/notices').then(list => list.find(x => x.id === id)).catch(() => null)
    if (n) openNoticeModal(n)
  }
  global.deleteNotice = async (id) => {
    if (!confirm('공지를 삭제하시겠습니까?')) return
    await API.del('/admin/notices/' + id)
    loadNotices()
  }
  global.openTicketSeq = function (idx) {
    if (!global._seq.ticket) return
    global._seq.ticket.idx = idx
    openTicket(global._seq.ticket.list[idx].id)
  }
  global.openTicket = openTicket
  global.deleteTicket = async (id) => {
    if (!confirm('문의를 삭제하시겠습니까?')) return
    await API.del('/admin/tickets/' + id)
    loadTickets('all')
  }
  global.openFaqEdit = async (id) => {
    const faqs = await API.get('/admin/faqs').catch(() => [])
    const f = faqs.find(x => x.id === id)
    if (f) openFaqModal(f)
  }
  global.deleteFaq = async (id) => {
    if (!confirm('FAQ를 삭제하시겠습니까?')) return
    await API.del('/admin/faqs/' + id)
    loadFaqs()
  }

  global.AdminSupport = {
    loadNotices,
    loadTickets,
    loadFaqs,
    bindSupportEvents,
  }

  if (global.AdminRouter) {
    global.AdminRouter.registerLoaders({
      notices: loadNotices,
      tickets: () => loadTickets('open'),
      faqs: loadFaqs,
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindSupportEvents)
  } else {
    bindSupportEvents()
  }
})(window)
