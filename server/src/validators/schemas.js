import { z } from 'zod';
import { passwordProblem } from './passwordPolicy.js';

const req = (label) => ({ error: `${label} is required` });

const email = z.string(req('Email')).trim().toLowerCase().email('Enter a valid email address').max(120);
const name = z.string(req('Name')).trim().min(2, 'Name must be at least 2 characters').max(60);
const password = z
  .string(req('Password'))
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long') // cheap cap before the byte-exact check below
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/\d/, 'Password must contain a number');
const boardTitle = z.string(req('Title')).trim().min(1, 'Title is required').max(120);

const checkedPassword = (data, ctx) => {
  const problem = passwordProblem(data.password, data);
  if (problem) ctx.addIssue({ code: 'custom', path: ['password'], message: problem });
};
export const registerSchema = { body: z.object({ name, email, password }).superRefine(checkedPassword) };
export const loginSchema = { body: z.object({ email, password: z.string(req('Password')).min(1, 'Password is required') }) };
export const forgotPasswordSchema = { body: z.object({ email }) };
export const resetPasswordSchema = {
  body: z
    .object({ email, code: z.string(req('Code')).trim().regex(/^\d{6}$/, 'Enter the 6-digit code from the email'), password })
    .superRefine(checkedPassword),
};
export const updateProfileSchema = { body: z.object({ name }) };

export const objectIdParam = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const listBoardsSchema = {
  query: z.object({
    q: z.string().trim().max(120).optional(),
    scope: z.enum(['all', 'owned', 'shared', 'recent']).default('all'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(60).default(24),
  }),
};
export const createBoardSchema = { body: z.object({ title: boardTitle.default('Untitled board') }) };
export const boardIdSchema = { params: z.object({ id: objectIdParam }) };
export const renameBoardSchema = { params: z.object({ id: objectIdParam }), body: z.object({ title: boardTitle }) };

const memberRole = z.enum(['editor', 'viewer']);
export const memberParams = { params: z.object({ id: objectIdParam, userId: objectIdParam }) };
export const addMemberSchema = { params: z.object({ id: objectIdParam }), body: z.object({ email, role: memberRole.default('editor') }) };
export const changeRoleSchema = { params: memberParams.params, body: z.object({ role: memberRole }) };

export const thumbnailSchema = {
  params: z.object({ id: objectIdParam }),
  body: z.object({
    thumbnail: z
      .string()
      .max(400_000, 'Thumbnail is too large')
      .regex(/^data:image\/(png|jpeg|webp);base64,/, 'Thumbnail must be a base64 image')
      .nullable(),
  }),
};

// Session history & playback (Phase 4)
const sessionParams = z.object({ id: objectIdParam, sessionId: objectIdParam });
export const listSessionsSchema = {
  params: z.object({ id: objectIdParam }),
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    includeEmpty: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  }),
};
export const sessionIdSchema = { params: sessionParams };
export const sessionEventsSchema = {
  params: sessionParams,
  query: z.object({
    after: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(1000).default(300),
  }),
};
export const sessionStateSchema = { params: sessionParams, query: z.object({ t: z.coerce.number().min(0).default(0) }) };

// Analytics (Phase 5). tz = minutes east of UTC; every real UTC offset is a multiple of 15.
export const analyticsSchema = {
  params: z.object({ id: objectIdParam }),
  query: z.object({
    tz: z.coerce.number().int().min(-840).max(840).refine((v) => v % 15 === 0, 'tz must be a multiple of 15 minutes').default(0),
    days: z.coerce.number().int().min(7).max(60).default(30),
  }),
};

export const listNotificationsSchema = {
  query: z.object({
    limit: z.coerce.number().int().min(1).max(50).default(30),
    before: z.string().datetime().optional(),
  }),
};
export const markReadSchema = {
  body: z.union([
    z.object({ all: z.literal(true) }),
    z.object({ ids: z.array(objectIdParam).min(1).max(100) }),
  ]),
};
