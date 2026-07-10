const admin = require('firebase-admin')
const crypto = require('crypto')

const EXT_BY_MIME = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
}

const BUCKET_CANDIDATES = () => {
  const projectId = process.env.FIREBASE_PROJECT_ID || 'vcml-30438'
  return [...new Set([
    process.env.FIREBASE_STORAGE_BUCKET,
    `${projectId}.firebasestorage.app`,
    `${projectId}.appspot.com`,
  ].filter(Boolean))]
}

let _resolvedBucket = null

async function resolveBucket() {
  if (_resolvedBucket) return _resolvedBucket
  const errors = []
  for (const name of BUCKET_CANDIDATES()) {
    const bucket = admin.storage().bucket(name)
    try {
      const [exists] = await bucket.exists()
      if (exists) {
        _resolvedBucket = bucket
        return bucket
      }
      errors.push(`${name}: 없음`)
    } catch (e) {
      errors.push(`${name}: ${e.message}`)
    }
  }
  throw new Error(
    'Firebase Storage 버킷을 찾을 수 없습니다. Firebase Console → Storage → 「시작하기」로 Storage를 활성화한 뒤 '
    + 'FIREBASE_STORAGE_BUCKET 환경 변수를 설정해주세요.'
    + (errors.length ? ` (시도: ${errors.join('; ')})` : '')
  )
}

function sanitizeCourseId(courseId) {
  const id = String(courseId || 'draft').trim()
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return 'draft'
  return id.slice(0, 128)
}

async function uploadImageBuffer(buffer, { folder, contentType }) {
  if (!buffer || !Buffer.isBuffer(buffer) || !buffer.length) {
    throw new Error('업로드할 이미지 데이터가 없습니다.')
  }
  const ext = EXT_BY_MIME[String(contentType || '').toLowerCase()] || 'bin'
  const filePath = `${folder}/${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${ext}`
  const bucket = await resolveBucket()
  const file = bucket.file(filePath)
  await file.save(buffer, {
    metadata: {
      contentType: contentType || 'application/octet-stream',
      cacheControl: 'public, max-age=31536000, immutable',
    },
    resumable: false,
  })
  try {
    await file.makePublic()
  } catch (_) {
    // uniform bucket-level access 사용 시 makePublic 생략
  }
  return `https://storage.googleapis.com/${bucket.name}/${filePath}`
}

async function uploadCourseImage(buffer, { kind, courseId, contentType }) {
  const safeId = sanitizeCourseId(courseId)
  const folder = kind === 'thumbnail'
    ? `courses/${safeId}/thumbnail`
    : `courses/${safeId}/detail-intro`
  return uploadImageBuffer(buffer, { folder, contentType })
}

async function getSignedDownloadUrl(filePath, expiresMs = 15 * 60 * 1000) {
  if (!filePath) throw new Error('파일 경로가 필요합니다.')
  const bucket = await resolveBucket()
  const file = bucket.file(filePath)
  const [exists] = await file.exists()
  if (!exists) {
    throw new Error(`파일을 찾을 수 없습니다: ${filePath}`)
  }
  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + expiresMs,
  })
  return url
}

module.exports = {
  BUCKET_CANDIDATES,
  resolveBucket,
  uploadCourseImage,
  uploadImageBuffer,
  getSignedDownloadUrl,
}
