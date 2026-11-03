// Password rules shared by sign-up and password reset.
// Length counts BYTES, because bcrypt only reads the first 72 bytes: a longer password (or one with emoji / non-Latin letters)
// would otherwise be silently cut short and the extra characters would not protect anything.
export const MAX_PASSWORD_BYTES = 72;

// The most used passwords that still satisfy "8+ characters, a letter and a number".
const COMMON = new Set([
  'password1', 'password12', 'password123', 'password1234', 'passw0rd', 'p@ssw0rd', 'qwerty123', 'qwerty1234', 'qwerty12345', 'qwertyuiop1',
  '12345678a', 'a12345678', 'abc12345', 'abcd1234', 'abc123456', 'abcd12345', 'iloveyou1', 'iloveyou123', 'welcome1', 'welcome123', 'admin123',
  'admin1234', 'letmein123', 'monkey123', 'dragon123', 'football1', 'baseball1', 'sunshine1', 'princess1', 'master123', 'login123', 'test1234',
  'changeme1', 'changeme123', 'pakistan1', 'pakistan123', 'lahore123', 'islamabad1', 'karachi123', 'allahis1', 'bismillah1', 'whatever1', 'trustno1',
  'superman1', 'batman123', 'michael1', 'jordan23', 'shadow123', 'ashley123', 'jessica1', 'charlie1', 'collabboard1', 'collabboard123',
]);

export function passwordProblem(password, { email, name } = {}) {
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) return `Password must be at most ${MAX_PASSWORD_BYTES} bytes (shorter if it has emoji or non-Latin letters)`;
  const lower = password.toLowerCase();
  if (COMMON.has(lower) || /^(.)\1{6,}\d?$/.test(lower) || /^(?:1234567890|123456789|12345678)[a-z0-9]{0,2}$/.test(lower)) return 'That password is too common. Pick something less guessable.';
  const local = email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) return 'Password must not contain your email address';
  if (name && name.length >= 4 && lower === name.toLowerCase().replace(/\s+/g, '')) return 'Password must not be your name';
  return null;
}
