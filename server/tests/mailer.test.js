import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { SMTPServer } from 'smtp-server';
import { createSmtpMailer, resetCodeEmail } from '../src/services/mailer.js';

// A real SMTP conversation against a local SMTP server (nothing leaves the machine).
test('SMTP mailer delivers the reset code email over the SMTP protocol', async () => {
  const received = [];
  const server = new SMTPServer({
    authOptional: true, disabledCommands: ['STARTTLS'],
    onData(stream, session, cb) { let raw = ''; stream.on('data', (c) => { raw += c; }); stream.on('end', () => { received.push({ raw, from: session.envelope.mailFrom.address, to: session.envelope.rcptTo.map((r) => r.address) }); cb(); }); },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const mailer = createSmtpMailer({ smtpUrl: `smtp://127.0.0.1:${server.server.address().port}?ignoreTLS=true`, from: 'CollabBoard <no-reply@collab.test>' });
    await mailer.send({ to: 'ada@x.dev', ...resetCodeEmail({ name: 'Ada', code: '493017', minutes: 10 }) });
    assert.equal(received.length, 1);
    assert.deepEqual(received[0].to, ['ada@x.dev']); assert.equal(received[0].from, 'no-reply@collab.test');
    assert.match(received[0].raw, /Subject: Your CollabBoard password reset code/);
    assert.match(received[0].raw, /493017/);
    assert.match(received[0].raw, /multipart\/alternative/, 'plain text and HTML parts');
  } finally { await new Promise((r) => server.close(r)); }
});

test('only a single plain address is accepted as recipient (no lists, no header injection)', async () => {
  const received = [];
  const server = new SMTPServer({ authOptional: true, disabledCommands: ['STARTTLS'], onData(stream, s, cb) { let raw = ''; stream.on('data', (c) => { raw += c; }); stream.on('end', () => { received.push(raw); cb(); }); } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const mailer = createSmtpMailer({ smtpUrl: `smtp://127.0.0.1:${server.server.address().port}?ignoreTLS=true`, from: 'a@b.test' });
    for (const to of ['victim@x.dev\r\nBcc: attacker@evil.test', 'a@x.dev, b@y.dev', 'Name <a@x.dev>', 'a@x.dev;b@y.dev']) {
      await assert.rejects(mailer.send({ to, subject: 's', text: 't' }), /single plain email address/, to);
    }
    assert.equal(received.length, 0, 'nothing reached the SMTP server');
  } finally { await new Promise((r) => server.close(r)); }
});
