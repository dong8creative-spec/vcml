const { fetchPlaylistStats } = require('../lib/youtube-portfolio')

;(async () => {
  const url = process.argv[2] || 'https://www.youtube.com/playlist?list=PLDFVA5BZ0YD_EAFKtvfenBH1TXy_wW6S4'
  const stats = await fetchPlaylistStats(url)
  console.log(JSON.stringify({
    videoCount: stats.videoCount,
    totalViews: stats.totalViews,
    averageViews: stats.averageViews,
    videos: stats.videos?.map((v) => ({ title: v.title?.slice(0, 40), viewCount: v.viewCount })),
  }, null, 2))
})().catch(console.error)
