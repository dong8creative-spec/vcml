const {
  extractPlaylistId,
  normalizePlaylistUrl,
} = require('../lib/youtube-portfolio')

async function getInnertubeConfig() {
  const res = await fetch('https://www.youtube.com/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'ko-KR,ko;q=0.9',
    },
  })
  const html = await res.text()
  const key = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1]
  const version = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1]
  return { key, version }
}

async function innertubePost(endpoint, body) {
  const { key, version } = await getInnertubeConfig()
  const payload = {
    ...body,
    context: {
      client: {
        hl: 'ko',
        gl: 'KR',
        clientName: 'WEB',
        clientVersion: version,
      },
    },
  }
  const res = await fetch(`https://www.youtube.com/youtubei/v1/${endpoint}?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return res.json()
}

;(async () => {
  const url = process.argv[2] || 'https://www.youtube.com/playlist?list=PLDFVA5BZ0YD_EAFKtvfenBH1TXy_wW6S4'
  const listId = extractPlaylistId(url)
  const data = await innertubePost('browse', { browseId: `VL${listId}`, params: 'wgYCCAA%3D' })
  const flat = JSON.stringify(data)
  console.log('len', flat.length)
  for (const p of ['playlistVideoRenderer', 'gridVideoRenderer', 'videoRenderer', 'lockupViewModel', 'compactVideoRenderer', 'playlistPanelVideoRenderer', 'reelItemRenderer']) {
    console.log(p, (flat.match(new RegExp(p, 'g')) || []).length)
  }
  const idx = flat.indexOf('lockupViewModel')
  if (idx >= 0) console.log('lockup sample', flat.slice(idx, idx + 500))
})().catch(console.error)
