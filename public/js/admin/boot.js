/** Admin boot helpers.
 * 기존 인라인 부트 로직을 점진적으로 옮기기 위한 얇은 공통 레이어입니다.
 */
;(function (global) {
  function qs(selector, root = document) {
    return root.querySelector(selector)
  }

  function qsa(selector, root = document) {
    return [...root.querySelectorAll(selector)]
  }

  function on(root, eventName, selector, handler) {
    const target = typeof root === 'string' ? document.querySelector(root) : (root || document)
    if (!target) return
    target.addEventListener(eventName, (event) => {
      const match = event.target.closest(selector)
      if (!match || !target.contains(match)) return
      handler(event, match)
    })
  }

  function action(name, handler, root = document) {
    on(root, 'click', `[data-action="${name}"]`, handler)
  }

  function setBusy(button, busy, label) {
    if (!button) return
    button.disabled = !!busy
    if (label !== undefined) {
      if (!button.dataset.idleText) button.dataset.idleText = button.textContent
      button.textContent = busy ? label : button.dataset.idleText
    }
  }

  global.AdminUI = {
    qs,
    qsa,
    on,
    action,
    setBusy,
  }
})(window)
