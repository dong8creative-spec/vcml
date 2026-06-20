require('dotenv').config({ path: require('path').join(__dirname, '.env') })
const express = require('express')
const cors = require('cors')
const path = require('path')

const app = express()
app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

app.use('/api/auth',    require('./routes/auth'))
app.use('/api/courses', require('./routes/courses'))
app.use('/api/orders',  require('./routes/orders'))
app.use('/api/my',      require('./routes/my'))
app.use('/api/admin',   require('./routes/admin'))

// SPA fallback — 없는 경로는 index.html로
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' })
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

const PORT = process.env.PORT || 3300
app.listen(PORT, () => console.log(`✓ 타닥클래스 서버 실행 중: http://localhost:${PORT}`))
