import mongoose from 'mongoose';

// A one-time code sent to a person's email (currently: password reset). Only an HMAC of the code is stored.
// One live challenge per user and purpose: asking for a new code replaces the old one.
// `expiresAt` is when the code stops working; the document itself lives until `purgeAt` so the
// "at most N codes per hour" memory survives the code's own short life.
const otpChallengeSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    purpose: { type: String, enum: ['password_reset'], required: true },
    codeHash: { type: String, required: true },
    attempts: { type: Number, default: 0 }, // wrong or right, every check of the code counts
    expiresAt: { type: Date, required: true },
    sentAt: { type: Date, required: true },
    sends: { type: Number, default: 1 }, // codes sent in the current hour window
    sendsWindowStart: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    purgeAt: { type: Date, required: true },
  },
  { versionKey: false }
);

otpChallengeSchema.index({ userId: 1, purpose: 1 }, { unique: true });
otpChallengeSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

export const OtpChallenge = mongoose.model('OtpChallenge', otpChallengeSchema);
