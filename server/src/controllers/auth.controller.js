import bcrypt from 'bcrypt';
import { User, USER_COLORS } from '../models/User.js';
import {
  REFRESH_COOKIE,
  issueRefreshToken,
  refreshCookieOptions,
  revokeRefreshToken,
  rotateRefreshToken,
  signAccessToken,
} from '../services/token.service.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler, ok } from '../utils/http.js';

const BCRYPT_ROUNDS = 12;
// Compared against when the email is unknown so response time doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('collabboard-dummy-password', BCRYPT_ROUNDS);

async function startSession(res, user, status = 200) {
  const refreshToken = await issueRefreshToken(user._id);
  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions);
  return ok(res, { user: user.toPublic(), accessToken: signAccessToken(user._id.toString()) }, { status });
}

export const register = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;
  if (await User.exists({ email })) throw ApiError.conflict('An account with this email already exists');

  const count = await User.estimatedDocumentCount();
  const user = await User.create({
    name,
    email,
    passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
    color: USER_COLORS[count % USER_COLORS.length],
  });
  return startSession(res, user, 201);
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select('+passwordHash');
  const valid = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !valid) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password');
  return startSession(res, user);
});

export const refresh = asyncHandler(async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) throw ApiError.unauthorized('No active session');
  try {
    const { user, accessToken, refreshToken } = await rotateRefreshToken(token);
    res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions);
    return ok(res, { user: user.toPublic(), accessToken });
  } catch (err) {
    res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions, maxAge: undefined });
    throw err;
  }
});

export const logout = asyncHandler(async (req, res) => {
  await revokeRefreshToken(req.cookies?.[REFRESH_COOKIE]);
  res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions, maxAge: undefined });
  return ok(res, { loggedOut: true });
});

export const me = asyncHandler(async (req, res) => ok(res, { user: req.user.toPublic() }));

export const updateMe = asyncHandler(async (req, res) => {
  req.user.name = req.body.name;
  await req.user.save();
  return ok(res, { user: req.user.toPublic() });
});
