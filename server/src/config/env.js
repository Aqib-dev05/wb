import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(5000),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(7),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  // Number of reverse proxies in front of the API (0 = none). Rate limits key on the client IP, so this must be right:
  // too high lets clients spoof X-Forwarded-For, too low makes every user share the proxy's IP. Default: 1 in production.
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).optional(),
  // Email (password reset codes). Production requires SMTP_URL, e.g. smtps://user:pass@smtp.example.com:465
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('CollabBoard <no-reply@collabboard.local>'),
  OTP_SECRET: z.string().min(32, 'OTP_SECRET must be at least 32 characters').optional(),
  // Live calls (WebRTC). STUN is used by default; add a TURN relay for strict networks.
  STUN_URLS: z.string().optional(),
  TURN_URLS: z.string().optional(),
  TURN_SECRET: z.string().optional(),
  TURN_USERNAME: z.string().optional(),
  TURN_CREDENTIAL: z.string().optional(),
});

const parsed = schema
  .superRefine((v, ctx) => {
    if (v.NODE_ENV !== 'production') return;
    if (!v.SMTP_URL) ctx.addIssue({ code: 'custom', path: ['SMTP_URL'], message: 'SMTP_URL is required in production (password reset sends codes by email)' });
    for (const k of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
      if (v[k].length < 32) ctx.addIssue({ code: 'custom', path: [k], message: `${k} must be at least 32 characters in production` });
    }
    if (v.JWT_ACCESS_SECRET === v.JWT_REFRESH_SECRET) ctx.addIssue({ code: 'custom', path: ['JWT_REFRESH_SECRET'], message: 'JWT_REFRESH_SECRET must differ from JWT_ACCESS_SECRET' });
  })
  .safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

export const env = { ...parsed.data, TRUST_PROXY: parsed.data.TRUST_PROXY ?? (parsed.data.NODE_ENV === 'production' ? 1 : 0) };
export const isProd = env.NODE_ENV === 'production';
