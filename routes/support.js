const router = require('express').Router()
const db = require('../db/schema')
const { buildAutoReply } = require('../lib/supportAutoReply')
const { sendMail } = require('../utils/mailer')

// POST /api/support/tickets — public, matches public/inquiry.html's ticket-form submit
router.post('/tickets', async (req, res) => {
  try {
    const { name, email, type, subject, content, user_id } = req.body
    if (!name || !email || !subject || !content) {
      return res.status(400).json({ error: '이름, 이메일, 제목, 내용은 필수입니다.' })
    }
    const ticket = await db.createTicket({ name, email, type, subject, content, user_id })
    const autoReply = buildAutoReply(ticket)
    await db.markTicketAutoReplied(ticket.id, autoReply)
    await sendMail({
      to: email,
      subject: `[타닥클래스] 문의가 접수되었습니다 — ${subject}`,
      text: autoReply,
    })
    res.json({ success: true, ticket_id: ticket.id })
  } catch (e) {
    console.error('문의 접수 오류:', e)
    res.status(500).json({ error: '문의 접수 중 오류가 발생했습니다. 다시 시도해주세요.' })
  }
})

module.exports = router
