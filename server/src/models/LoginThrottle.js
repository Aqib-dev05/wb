import mongoose from 'mongoose';

// Failed sign-in counter per email address (hashed), whether or not an account exists, so that
// locking out an address looks identical for real and made-up accounts.
const loginThrottleSchema = new mongoose.Schema(
  {
    key: { type: String, required: true }, // sha256 of the lower-cased email
    count: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    expiresAt: { type: Date, required: true }, // end of the counting window; also the TTL
  },
  { versionKey: false }
);

loginThrottleSchema.index({ key: 1 }, { unique: true });
loginThrottleSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const LoginThrottle = mongoose.model('LoginThrottle', loginThrottleSchema);
