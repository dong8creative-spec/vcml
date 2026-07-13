/** Admin 블로그 모듈: /blog 목록 관리 */
;(function (global) {
  const esc = (...args) => (global.esc || global.AdminUtils?.esc || String)(...args)

  let _blogEditId = null

  async function loadBlogPosts() {
    const tbody = document.getElementById('blog-tbody')
    if (!tbody) return
    try {
      const posts = await API.get('/admin/blog')
      if (!posts.length) {
        tbody.innerHTML = '<tr class="empty-state-row"><td colspan="4">등록된 글이 없습니다.</td></tr>'
        return
      }
      tbody.innerHTML = posts.map(p => `
          <tr>
            <td><strong style="font-size:14px">${esc(p.title)}</strong></td>
            <td><span class="status-tag ${p.is_published ? 'done' : 'draft'}">${p.is_published ? '공개' : '비공개'}</span></td>
            <td class="td-date">${(p.created_at || '').slice(0, 10)}</td>
            <td class="td-actions">
              <a class="btn-sm" href="/blog/${encodeURIComponent(p.slug)}" target="_blank">보기</a>
              <button class="btn-sm" onclick="openBlogEdit('${p.id}')">편집</button>
              <button class="btn-sm-danger" onclick="deleteBlogPost('${p.id}')">삭제</button>
            </td>
          </tr>`).join('')
    } catch (e) {
      tbody.innerHTML = `<tr class="empty-state-row"><td colspan="4">${e.message}</td></tr>`
    }
  }

  function openBlogModal(p) {
    _blogEditId = p ? p.id : null
    document.getElementById('blog-modal-title').textContent = p ? '글 편집' : '새 글 작성'
    document.getElementById('bm-title').value = p ? p.title : ''
    document.getElementById('bm-excerpt').value = p ? (p.excerpt || '') : ''
    document.getElementById('bm-cover').value = p ? (p.cover_image || '') : ''
    document.getElementById('bm-content').value = p ? p.content : ''
    document.getElementById('bm-public').checked = p ? !!p.is_published : false
    document.getElementById('blog-modal').style.display = 'flex'
  }

  function bindBlogEvents() {
    document.getElementById('blog-create-btn')?.addEventListener('click', () => openBlogModal(null))
    document.getElementById('bm-save')?.addEventListener('click', async () => {
      const title = document.getElementById('bm-title').value.trim()
      const content = document.getElementById('bm-content').value.trim()
      if (!title || !content) return alert('제목과 본문을 입력하세요.')
      const body = {
        title,
        content,
        excerpt: document.getElementById('bm-excerpt').value.trim(),
        cover_image: document.getElementById('bm-cover').value.trim(),
        is_published: document.getElementById('bm-public').checked,
      }
      try {
        if (_blogEditId) await API.patch('/admin/blog/' + _blogEditId, body)
        else await API.post('/admin/blog', body)
        document.getElementById('blog-modal').style.display = 'none'
        loadBlogPosts()
      } catch (e) {
        alert(e.message || '저장에 실패했습니다.')
      }
    })
  }

  global.openBlogEdit = async (id) => {
    const posts = await API.get('/admin/blog').catch(() => [])
    const p = posts.find(x => x.id === id)
    if (p) openBlogModal(p)
  }
  global.deleteBlogPost = async (id) => {
    if (!confirm('이 글을 삭제하시겠습니까?')) return
    await API.del('/admin/blog/' + id)
    loadBlogPosts()
  }

  global.AdminBlog = { loadBlogPosts, bindBlogEvents }

  if (global.AdminRouter) {
    global.AdminRouter.registerLoaders({ blog: loadBlogPosts })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindBlogEvents)
  } else {
    bindBlogEvents()
  }
})(window)
