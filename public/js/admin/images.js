/** Admin 이미지 리사이즈/WebP 유틸 */
;(function (global) {
  function resizeEditorApplyImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const img = new Image()
        img.onload = () => {
          const max = 960
          let w = img.width, h = img.height
          if (w > max || h > max) {
            if (w > h) { h = Math.round(h * max / w); w = max }
            else { w = Math.round(w * max / h); h = max }
          }
          const canvas = document.createElement('canvas')
          canvas.width = w; canvas.height = h
          canvas.getContext('2d').drawImage(img, 0, 0, w, h)
          resolve(canvas.toDataURL('image/jpeg', 0.85))
        }
        img.onerror = () => reject(new Error('이미지를 불러올 수 없습니다.'))
        img.src = reader.result
      }
      reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다.'))
      reader.readAsDataURL(file)
    })
  }

  function encodeCanvasWebpBlob(img, { maxWidth = 1000, maxHeight = 5000, maxBase64Len = 950000, quality = 0.85 } = {}) {
    let w = img.width
    let h = img.height
    if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth }
    if (h > maxHeight) { w = Math.round(w * maxHeight / h); h = maxHeight }

    const attempt = (width, height, q, scale) => new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)
      canvas.toBlob(blob => {
        if (!blob) {
          reject(new Error('이 브라우저는 WebP 변환을 지원하지 않습니다.'))
          return
        }
        const approxLen = Math.ceil(blob.size * 4 / 3) + 40
        if (approxLen > maxBase64Len && q > 0.45) {
          attempt(width, height, Math.round((q - 0.05) * 100) / 100, scale).then(resolve).catch(reject)
          return
        }
        if (approxLen > maxBase64Len && scale > 0.5) {
          const nextScale = Math.round((scale - 0.08) * 100) / 100
          attempt(
            Math.max(200, Math.round(w * nextScale)),
            Math.max(200, Math.round(h * nextScale)),
            Math.max(0.45, q),
            nextScale,
          ).then(resolve).catch(reject)
          return
        }
        if (approxLen > maxBase64Len) {
          reject(new Error('이미지를 충분히 압축할 수 없습니다. 더 작은 WebP 파일을 사용해주세요.'))
          return
        }
        resolve(blob)
      }, 'image/webp', q)
    })

    return attempt(w, h, quality, 1)
  }

  function encodeCanvasWebp(img, { maxWidth = 1000, maxHeight = 5000, maxBase64Len = 950000, quality = 0.85 } = {}) {
    let w = img.width
    let h = img.height
    if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth }
    if (h > maxHeight) { w = Math.round(w * maxHeight / h); h = maxHeight }

    const encode = (width, height, q) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, width, height)
      const dataUrl = canvas.toDataURL('image/webp', q)
      if (!dataUrl.startsWith('data:image/webp')) {
        throw new Error('이 브라우저는 WebP 변환을 지원하지 않습니다.')
      }
      return dataUrl
    }

    let q = quality
    let dataUrl = encode(w, h, q)
    while (dataUrl.length > maxBase64Len && q > 0.45) {
      q = Math.round((q - 0.05) * 100) / 100
      dataUrl = encode(w, h, q)
    }
    let scale = 1
    while (dataUrl.length > maxBase64Len && scale > 0.5) {
      scale = Math.round((scale - 0.08) * 100) / 100
      const sw = Math.max(200, Math.round(w * scale))
      const sh = Math.max(200, Math.round(h * scale))
      dataUrl = encode(sw, sh, Math.max(0.45, q))
    }
    if (dataUrl.length > maxBase64Len) {
      throw new Error('이미지를 충분히 압축할 수 없습니다. 더 작은 WebP 파일을 사용해주세요.')
    }
    return dataUrl
  }

  function convertImageSrcToWebp(src, opts) {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        try { resolve(encodeCanvasWebp(img, opts)) }
        catch (e) { reject(new Error('WebP 변환에 실패했습니다.')) }
      }
      img.onerror = () => reject(new Error('이미지를 불러올 수 없습니다.'))
      img.src = src
    })
  }

  function resizeCanvasImageToWebpFromSource(file, opts) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const img = new Image()
        img.onload = () => {
          try { resolve(encodeCanvasWebp(img, opts)) }
          catch (e) { reject(new Error('WebP 변환에 실패했습니다.')) }
        }
        img.onerror = () => reject(new Error('이미지를 불러올 수 없습니다.'))
        img.src = reader.result
      }
      reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다.'))
      reader.readAsDataURL(file)
    })
  }

  function resizeDetailIntroWebp(file, opts) {
    if (file.type !== 'image/webp' && !file.name.toLowerCase().endsWith('.webp')) {
      return Promise.reject(new Error('WebP 이미지만 업로드할 수 있습니다.'))
    }
    return resizeCanvasImageToWebpFromSource(file, opts)
  }

  function resizeDetailIntroWebpToBlob(file, opts) {
    if (file.type !== 'image/webp' && !file.name.toLowerCase().endsWith('.webp')) {
      return Promise.reject(new Error('WebP 이미지만 업로드할 수 있습니다.'))
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const img = new Image()
        img.onload = () => encodeCanvasWebpBlob(img, opts).then(resolve).catch(reject)
        img.onerror = () => reject(new Error('이미지를 불러올 수 없습니다.'))
        img.src = reader.result
      }
      reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다.'))
      reader.readAsDataURL(file)
    })
  }

  function resizeUploadImage(file, { maxWidth = 1000, maxHeight = null, maxBase64Len = 450000, quality = 0.85 } = {}) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const img = new Image()
        img.onload = () => {
          let w = img.width
          let h = img.height
          const limitW = maxWidth || 1200
          const limitH = maxHeight || limitW
          if (w > limitW) { h = Math.round(h * limitW / w); w = limitW }
          if (h > limitH) { w = Math.round(w * limitH / h); h = limitH }

          const encode = (width, height, q) => {
            const canvas = document.createElement('canvas')
            canvas.width = width
            canvas.height = height
            const ctx = canvas.getContext('2d')
            ctx.fillStyle = '#ffffff'
            ctx.fillRect(0, 0, width, height)
            ctx.drawImage(img, 0, 0, width, height)
            return canvas.toDataURL('image/jpeg', q)
          }

          let q = quality
          let dataUrl = encode(w, h, q)
          while (dataUrl.length > maxBase64Len && q > 0.5) {
            q = Math.round((q - 0.05) * 100) / 100
            dataUrl = encode(w, h, q)
          }
          let scale = 1
          while (dataUrl.length > maxBase64Len && scale > 0.45) {
            scale = Math.round((scale - 0.1) * 100) / 100
            const sw = Math.max(320, Math.round(w * scale))
            const sh = Math.max(240, Math.round(h * scale))
            dataUrl = encode(sw, sh, Math.max(0.5, q))
          }
          if (dataUrl.length > maxBase64Len) {
            reject(new Error('이미지를 충분히 압축할 수 없습니다. 더 작은 이미지를 사용해주세요.'))
            return
          }
          resolve(dataUrl)
        }
        img.onerror = () => reject(new Error('이미지를 불러올 수 없습니다.'))
        img.src = reader.result
      }
      reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다.'))
      reader.readAsDataURL(file)
    })
  }

  function resizeSiteImage(file, max = 800) {
    return resizeUploadImage(file, { maxWidth: max, maxHeight: max, maxBase64Len: 450000 })
  }

  global.AdminImages = {
    resizeEditorApplyImage,
    encodeCanvasWebpBlob,
    encodeCanvasWebp,
    convertImageSrcToWebp,
    resizeCanvasImageToWebpFromSource,
    resizeDetailIntroWebp,
    resizeDetailIntroWebpToBlob,
    resizeUploadImage,
    resizeSiteImage,
  }
})(window)
