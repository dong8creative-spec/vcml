const fs = require('fs')
const path = require('path')

const DETAIL_ROOT = path.join(__dirname, '..', 'public', 'course-detail')
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'])

function isDetailAssetFile(name) {
  const base = String(name || '').trim()
  if (!base || base.startsWith('.')) return false
  const low = base.toLowerCase()
  if (low === 'readme.md' || low === 'readme.txt') return false
  return IMAGE_EXT.has(path.extname(low))
}

function listCourseDetailFolderImages(slug) {
  const safeSlug = String(slug || '').trim()
  if (!safeSlug) return []
  const dir = path.join(DETAIL_ROOT, safeSlug)
  if (!fs.existsSync(dir)) return []

  const items = []
  const queue = ['']
  const visited = new Set()
  while (queue.length) {
    const relativeDir = queue.shift()
    if (visited.has(relativeDir)) continue
    visited.add(relativeDir)
    const abs = relativeDir ? path.join(dir, relativeDir) : dir
    let entries = []
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true })
    } catch {
      continue
    }
    const subdirs = []
    for (const ent of entries) {
      if (ent.isDirectory()) {
        subdirs.push(ent.name)
        continue
      }
      if (!ent.isFile() || !isDetailAssetFile(ent.name)) continue
      const fileAbs = path.join(abs, ent.name)
      let orderMs = 0
      try {
        const st = fs.statSync(fileAbs)
        orderMs = st.birthtimeMs || st.mtimeMs || 0
      } catch {}
      const rel = relativeDir ? `${relativeDir}/${ent.name}` : ent.name
      const parts = [safeSlug, ...rel.split('/')].map(p => encodeURIComponent(p))
      items.push({ orderMs, url: `/course-detail/${parts.join('/')}` })
    }
    for (const name of subdirs) {
      queue.push(relativeDir ? `${relativeDir}/${name}` : name)
    }
  }

  items.sort((a, b) => a.orderMs - b.orderMs)
  return items.filter(i => i.url).map(i => i.url)
}

function mergeDetailIntroImages(course, slug) {
  const fromDb = []
  if (Array.isArray(course?.detail_intro_images)) {
    for (const src of course.detail_intro_images) {
      const s = String(src || '').trim()
      if (s) fromDb.push(s)
    }
  } else if (String(course?.detail_intro_image || '').trim()) {
    fromDb.push(String(course.detail_intro_image).trim())
  }

  const fromFolder = listCourseDetailFolderImages(slug || course?.slug)
  const seen = new Set()
  const merged = []
  for (const src of [...fromDb, ...fromFolder]) {
    if (!seen.has(src)) {
      seen.add(src)
      merged.push(src)
    }
  }
  return merged.length ? merged : null
}

module.exports = {
  DETAIL_ROOT,
  listCourseDetailFolderImages,
  mergeDetailIntroImages,
}
