import nodemailer from 'nodemailer';

// Outgoing email. Production uses SMTP (SMTP_URL). Without it (local development only) messages are printed to the
// server console so the flow can be tried without a mail server; the config check refuses that setup in production.
// Tests use createMemoryMailer() and read `outbox`.

// Exactly one plain address. nodemailer would parse "a@x.dev\r\nBcc: b@y.dev" as a list and deliver to the OTHER address, so the check lives here.
const SINGLE_ADDRESS = /^[^\s<>,;"'()[\]\\]+@[^\s<>,;"'()[\]\\]+$/;
export function assertSingleAddress(to) {
  if (typeof to !== 'string' || to.length > 254 || !SINGLE_ADDRESS.test(to)) throw new Error('Refusing to send: recipient is not a single plain email address');
}

export function createSmtpMailer({ smtpUrl, from }) {
  const transport = nodemailer.createTransport(smtpUrl);
  return {
    kind: 'smtp',
    async send({ to, subject, text, html }) {
      assertSingleAddress(to);
      return transport.sendMail({ from, to, subject, text, html });
    },
  };
}

export function createConsoleMailer() {
  return {
    kind: 'console',
    async send({ to, subject, text }) {
      console.log(`\n[mail:dev] To: ${to}\n[mail:dev] Subject: ${subject}\n${text}\n`);
    },
  };
}

export function createMemoryMailer() {
  const outbox = [];
  return { kind: 'memory', outbox, fail: false, async send(message) { if (this.fail) throw new Error('mail down'); outbox.push({ ...message, at: Date.now() }); } };
}

export function createMailer({ smtpUrl, from }) {
  return smtpUrl ? createSmtpMailer({ smtpUrl, from }) : createConsoleMailer();
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function resetCodeEmail({ name, code, minutes }) {
  const text = `Hi ${name},

Your CollabBoard password reset code is: ${code}

It works for ${minutes} minutes and can be used once. If you did not ask to reset your password, you can ignore this email; your password stays as it is. Never share this code with anyone.`;
  const html = `<p>Hi ${escapeHtml(name)},</p>
<p>Your CollabBoard password reset code is:</p>
<p style="font-size:28px;letter-spacing:6px;font-weight:700;font-family:monospace">${escapeHtml(code)}</p>
<p>It works for ${minutes} minutes and can be used once. If you did not ask to reset your password, you can ignore this email; your password stays as it is. Never share this code with anyone.</p>`;
  return { subject: 'Your CollabBoard password reset code', text, html };
}

export function passwordChangedEmail({ name }) {
  const text = `Hi ${name},

The password for your CollabBoard account was just changed, and you were signed out everywhere. If this was you, nothing more to do. If it was not, reset your password again right away and check who has access to your email.`;
  const html = `<p>Hi ${escapeHtml(name)},</p><p>The password for your CollabBoard account was just changed, and you were signed out everywhere.</p><p>If this was you, nothing more to do. If it was not, reset your password again right away and check who has access to your email.</p>`;
  return { subject: 'Your CollabBoard password was changed', text, html };
}
