async function getInnertubeConfig() {
  const res = await fetch('https://www.youtube.com/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'ko-KR,ko;q=0.9',
    },
  })
  const html = await res.text()
  return {
    key: html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1],
    version: html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1],
  }
}

async function innertubePost(endpoint, body) {
  const { key, version } = await getInnertubeConfig()
  const res = await fetch(`https://www.youtube.com/youtubei/v1/${endpoint}?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...body,
      context: { client: { hl: 'ko', gl: 'KR', clientName: 'WEB', clientVersion: version } },
    }),
  })
  return res.json()
}

function findLockups(node, out = []) {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const item of node) findLockups(item, out)
    return out
  }
  if (node.lockupViewModel) out.push(node.lockupViewModel)
  for (const value of Object.values(node)) findLockups(value, out)
  return out
}

;(async () => {
  const listId = (process.argv[2] || 'PLDFVA5BZ0YD_EAFKtvfenBH1TXy_wW6S4').replace(/^.*list=/, '')
  const data = await innertubePost('browse', { browseId: `VL${listId}`, params: 'wgYCCAA%3D' })
  const lockups = findLockups(data)
  console.log('lockups', lockups.length)
  if (lockups[0]) {
    console.log('keys', Object.keys(lockups[0]))
    console.log(JSON.stringify(lockups[0], null, 2))
  }
})().catch(console.error)
