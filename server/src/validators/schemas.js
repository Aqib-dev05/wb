import { z } from 'zod';

const req = (label) => ({ error: `${label} is required` });

const email = z.string(req('Email')).trim().toLowerCase().email('Enter a valid email address').max(120);
const name = z.string(req('Name')).trim().min(2, 'Name must be at least 2 characters').max(60);
const password = z
  .string(req('Password'))
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters') // bcrypt ignores bytes beyond 72
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/\d/, 'Password must contain a number');
const boardTitle = z.string(req('Title')).trim().min(1, 'Title is required').max(120);

export const registerSchema = { body: z.object({ name, email, password }) };
export const loginSchema = { body: z.object({ email, password: z.string(req('Password')).min(1, 'Password is required') }) };
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
