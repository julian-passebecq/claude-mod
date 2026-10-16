// veille e-mail: composition and the SMTP dialogue against an in-process fake server. node --test mods/veille/tests/mail.test.mjs
import assert from 'node:assert/strict'
import net from 'node:net'
import { test } from 'node:test'

import { compose, digest, encodeHeader, sendMail, smtpProblem } from '../lib/mail.mjs'

const PW = 'abcd efgh ijkl mnop'

// A fake SMTP server: records commands, answers like Gmail (STARTTLS offered; the test's connect() fakes the upgrade).
function fakeServer({ authOk = true } = {}) {
  const seen = []
  let message = ''
  const server = net.createServer((sock) => {
    let buf = ''
    let inData = false
    let step = ''
    sock.write('220 fake ESMTP\r\n')
    sock.on('data', (d) => {
      buf += d.toString('utf8')
      let i
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 2)
        if (inData) {
          if (line === '.') { inData = false; sock.write('250 queued\r\n') } else message += line + '\r\n'
          continue
        }
        seen.push(line)
        if (step === 'user') { step = 'pass'; sock.write('334 UGFzc3dvcmQ6\r\n'); continue }
        if (step === 'pass') { step = ''; sock.write(authOk ? '235 ok\r\n' : `535 bad credentials ${line}\r\n`); continue }
        if (/^EHLO/.test(line)) sock.write('250-fake\r\n250-STARTTLS\r\n250 AUTH LOGIN\r\n')
        else if (line === 'STARTTLS') sock.write('220 go ahead\r\n')
        else if (line === 'AUTH LOGIN') { step = 'user'; sock.write('334 VXNlcm5hbWU6\r\n') }
        else if (/^MAIL FROM/.test(line) || /^RCPT TO/.test(line)) sock.write('250 ok\r\n')
        else if (line === 'DATA') { inData = true; sock.write('354 go\r\n') }
        else if (line === 'QUIT') { sock.write('221 bye\r\n'); sock.end() }
        else sock.write('500 ?\r\n')
      }
    })
    sock.on('error', () => undefined)
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, seen, message: () => message })))
}

const connectTo = (port) => (o) => (o.upgrade ? o.upgrade : net.connect({ host: '127.0.0.1', port }))
const SMTP = (port) => ({ host: '127.0.0.1', port, user: 'me@example.com', password: PW, from: 'me@example.com', to: ['me@example.com'] })

test('compose: UTF-8 subject encoded, base64 body, CRLF lines', () => {
  const m = compose({ from: 'a@example.com', to: ['b@example.com'], subject: 'Veille : 2 conversations t’attendent', text: 'ligne 1\nça marche', date: new Date(Date.UTC(2026, 9, 16, 12)) })
  assert.match(m, /^Subject: =\?UTF-8\?B\?/m)
  assert.match(m, /Content-Transfer-Encoding: base64/)
  assert.ok(m.includes('\r\n\r\n'))
  const body = m.split('\r\n\r\n')[1].replace(/\r\n/g, '')
  assert.equal(Buffer.from(body, 'base64').toString('utf8'), 'ligne 1\r\nça marche')
  assert.equal(encodeHeader('plain'), 'plain')
  assert.equal(encodeHeader('a\r\nBcc: x'), 'a Bcc: x', 'no header injection')
})

test('digest: conversation, what it needs, since when, link', () => {
  const now = Date.UTC(2026, 9, 16, 12)
  const t = digest([{ title: 'Lane A', what: 'Attend Julian : choisir', since: now - 3600000, session_link: 'claude://x/1', link: 'https://gitlab.com/x/-/merge_requests/3' }], now, (ms) => `${ms / 60000} min`)
  assert.match(t, /Lane A/)
  assert.match(t, /Ce qu'il faut : Attend Julian : choisir/)
  assert.match(t, /Depuis : 60 min/)
  assert.match(t, /Lien : claude:\/\/x\/1/)
  assert.match(t, /PR\/MR : https:\/\/gitlab\.com/)
})

test('smtpProblem: missing file or placeholders mean « non configuré »', () => {
  assert.equal(smtpProblem(null), 'smtp.json absent')
  assert.match(smtpProblem({ host: 'h', user: '<you@example.com>', password: 'p', from: 'f', to: 't' }), /user/)
  assert.equal(smtpProblem(SMTP(587)), '')
})

test('sendMail: EHLO, STARTTLS, AUTH LOGIN, MAIL, RCPT, DATA with dot-stuffing; the password never appears in the log', async () => {
  const f = await fakeServer()
  try {
    const msg = compose({ from: 'me@example.com', to: ['me@example.com'], subject: 'test', text: 'x' }) + '\r\n.leading dot'
    const r = await sendMail(SMTP(f.port), msg, { connect: connectTo(f.port), timeoutMs: 5000 })
    assert.equal(r.ok, true)
    assert.deepEqual(f.seen.filter((l) => /^[A-Z]{4}/.test(l)).map((l) => l.split(/[ :]/)[0]), ['EHLO', 'STARTTLS', 'EHLO', 'AUTH', 'MAIL', 'RCPT', 'DATA'])
    assert.ok(f.seen.includes(Buffer.from(PW).toString('base64')), 'password sent base64 to the server only')
    assert.ok(f.message().includes('\r\n..leading dot'), 'dot-stuffed')
    assert.doesNotMatch(JSON.stringify(r.log), new RegExp(`${PW}|${Buffer.from(PW).toString('base64')}`))
  } finally { f.server.close() }
})

test('sendMail: a refused login rejects with a scrubbed error (no password, no base64)', async () => {
  const f = await fakeServer({ authOk: false })
  try {
    await assert.rejects(sendMail(SMTP(f.port), 'x', { connect: connectTo(f.port), timeoutMs: 5000 }), (e) => {
      assert.match(e.message, /SMTP 535/)
      assert.doesNotMatch(e.message, new RegExp(`${PW}|${Buffer.from(PW).toString('base64')}`))
      return true
    })
  } finally { f.server.close() }
})
