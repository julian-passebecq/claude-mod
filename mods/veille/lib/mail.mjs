// veille - e-mail: compose a plain-text UTF-8 message and send it with a minimal SMTP client (node:net / node:tls,
// no dependency). Port 587 = STARTTLS (Gmail with an app password), 465 = implicit TLS. AUTH LOGIN.
// The password is read from ~/.claude/veille/smtp.json by the caller and never logged: every error text goes through
// scrub() with the password and its base64 form removed.
import net from 'node:net'
import tls from 'node:tls'
import { scrub } from './core.mjs'

const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64')

export function encodeHeader(s) {
  const t = String(s ?? '').replace(/[\r\n]+/g, ' ')
  return /^[\x20-\x7e]*$/.test(t) ? t : `=?UTF-8?B?${b64(t)}?=`
}

export function smtpProblem(smtp) {
  if (!smtp || typeof smtp !== 'object') return 'smtp.json absent'
  for (const k of ['host', 'user', 'password', 'from', 'to']) if (!smtp[k] || /^<.*>$/.test(String(smtp[k]))) return `smtp.json : ${k} manquant`
  return ''
}

export function compose({ from, to, subject, text, date = new Date(), id = 'veille' }) {
  const rcpt = Array.isArray(to) ? to : [to]
  const body = b64(String(text ?? '').replace(/\r?\n/g, '\r\n')).replace(/.{1,76}/g, '$&\r\n')
  const host = String(from).split('@')[1] || 'localhost'
  return [
    `From: ${from}`,
    `To: ${rcpt.join(', ')}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${date.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${id}.${date.getTime()}@${host}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n')
}

// Digest of the alerts that need Julian: one e-mail per tour, each row with conversation, what, since, link.
export function digest(alerts, nowMs, fmtAge, sessionLink) {
  const lines = []
  for (const a of alerts) {
    lines.push(`• ${a.title || a.pr || 'conversation'}`)
    lines.push(`  Ce qu'il faut : ${a.what}`)
    lines.push(`  Depuis : ${fmtAge(nowMs - (a.since || nowMs))} (${new Date(a.since || nowMs).toLocaleString('fr-FR')})`)
    const l = a.session_link || a.link
    if (l) lines.push(`  Lien : ${l}`)
    if (a.link && a.session_link && a.link !== a.session_link) lines.push(`  PR/MR : ${a.link}`)
    lines.push('')
  }
  lines.push('Envoyé par la veille (claude-mod / veille). Ack dans le panneau Veille ou /veille ack <clé>.')
  return lines.join('\n')
}

// Send one message. `connect` is injectable for tests: (opts) => socket. Resolves {ok, log} or rejects with a scrubbed Error.
export async function sendMail(smtp, msg, { connect, timeoutMs = 30000 } = {}) {
  const secrets = [smtp.password]
  const port = Number(smtp.port || 587)
  const implicit = smtp.secure === true || port === 465
  const starttls = !implicit && smtp.starttls !== false
  const open = connect || ((o) => (o.tls ? tls.connect({ host: o.host, port: o.port, servername: o.host }) : net.connect({ host: o.host, port: o.port })))
  let sock = open({ host: smtp.host, port, tls: implicit })
  const log = []
  let buf = ''
  let waiter = null
  const onData = (d) => { buf += d.toString('utf8'); pump() }
  const pump = () => {
    if (!waiter) return
    const lines = buf.split('\r\n')
    for (let i = 0; i < lines.length - 1; i++) {
      if (/^\d{3} /.test(lines[i])) {
        const reply = lines.slice(0, i + 1)
        buf = lines.slice(i + 1).join('\r\n')
        const w = waiter
        waiter = null
        w.resolve({ code: Number(reply[i].slice(0, 3)), text: reply.join('\n') })
        return
      }
    }
  }
  const attach = (s) => { s.on('data', onData); s.on('error', (e) => waiter && waiter.reject(e)) }
  const read = () => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('SMTP : délai dépassé')), timeoutMs)
    waiter = { resolve: (v) => { clearTimeout(t); resolve(v) }, reject: (e) => { clearTimeout(t); reject(e) } }
    pump()
  })
  const cmd = async (line, expect, shown) => {
    if (line !== null) { sock.write(line + '\r\n'); log.push('> ' + (shown || line)) }
    const r = await read()
    log.push('< ' + r.code)
    if (!expect.includes(r.code)) throw new Error(`SMTP ${r.code} après ${shown || (line || 'connexion').split(' ')[0]} : ${r.text.split('\n').pop().slice(4, 160)}`)
    return r
  }
  try {
    attach(sock)
    await cmd(null, [220])
    const name = smtp.helo || 'veille.localhost'
    await cmd(`EHLO ${name}`, [250])
    if (starttls) {
      await cmd('STARTTLS', [220])
      sock.removeListener('data', onData)
      const plain = sock
      sock = connect ? open({ upgrade: plain, host: smtp.host }) : tls.connect({ socket: plain, servername: smtp.host })
      attach(sock)
      await new Promise((resolve, reject) => { if (connect) resolve(); else { sock.once('secureConnect', resolve); sock.once('error', reject) } })
      await cmd(`EHLO ${name}`, [250])
    }
    await cmd('AUTH LOGIN', [334])
    await cmd(b64(smtp.user), [334], '(utilisateur)')
    await cmd(b64(smtp.password), [235], '(mot de passe)')
    await cmd(`MAIL FROM:<${smtp.from}>`, [250])
    for (const r of Array.isArray(smtp.to) ? smtp.to : [smtp.to]) await cmd(`RCPT TO:<${r}>`, [250, 251])
    await cmd('DATA', [354])
    const data = msg.split('\r\n').map((l) => (l.startsWith('.') ? '.' + l : l)).join('\r\n')
    await cmd(`${data}\r\n.`, [250], '(message)')
    try { sock.write('QUIT\r\n') } catch { /* closing anyway */ }
    sock.end()
    return { ok: true, log }
  } catch (err) {
    try { sock.destroy() } catch { /* already closed */ }
    throw new Error(scrub(String(err && err.message ? err.message : err), secrets))
  }
}
