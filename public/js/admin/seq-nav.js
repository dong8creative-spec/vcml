/** Admin 순차 네비게이션 */
;(function (global) {
  global._seq = global._seq || {}
  global.seqSet = function (key, list, idx, openFn) {
    global._seq[key] = { list: list, idx: idx, open: openFn }
  }
  global.seqUpdateNav = function (key) {
    const s = global._seq[key]
    if (!s || s.idx < 0) return
    const nav = document.getElementById(key + '-seq-nav')
    const label = document.getElementById(key + '-seq-label')
    const prev = document.getElementById(key + '-seq-prev')
    const next = document.getElementById(key + '-seq-next')
    if (!nav) return
    if (s.list.length > 1) {
      nav.style.display = 'flex'
      if (label) label.textContent = (s.idx + 1) + ' / ' + s.list.length
      if (prev) prev.disabled = s.idx === 0
      if (next) next.disabled = s.idx === s.list.length - 1
    } else {
      nav.style.display = 'none'
    }
  }
  global.seqStep = function (key, delta) {
    const s = global._seq[key]
    if (!s) return
    const newIdx = s.idx + delta
    if (newIdx < 0 || newIdx >= s.list.length) return
    s.idx = newIdx
    s.open(s.list[newIdx])
  }
})(window)
