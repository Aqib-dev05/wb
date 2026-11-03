import bcrypt from 'bcrypt';
import { env } from '../config/env.js';

// Cost 12 in production (about a quarter of a second per hash). Tests use the minimum so suites stay fast.
const ROUNDS = env.NODE_ENV === 'test' ? 4 : 12;
export const hashPassword = (password) => bcrypt.hash(password, ROUNDS);
export const verifyPassword = (password, hash) => bcrypt.compare(password, hash);
// Compared against when the email is unknown, so response time doesn't reveal which emails exist.
export const DUMMY_HASH = bcrypt.hashSync('collabboard-dummy-password', ROUNDS);
