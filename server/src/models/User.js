import mongoose from 'mongoose';

// Palette used for avatars and, later, live cursor colors. Assigned once at registration
// so a participant keeps the same identity color across boards and sessions.
export const USER_COLORS = ['#5B4BFF', '#FF6B57', '#2FCB8E', '#F5A524', '#2E9BFF', '#E0489B', '#00B8C4', '#8A5CF6'];

const refreshTokenSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    // Set when the token is exchanged for a new one. A short grace window tolerates two tabs refreshing at once;
    // using it again after that means it was copied, and the whole account is signed out.
    usedAt: { type: Date, default: null },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    color: { type: String, default: USER_COLORS[0] },
    refreshTokens: { type: [refreshTokenSchema], default: [], select: false },
    // Access tokens issued before this moment are rejected (password reset signs every device out).
    passwordChangedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

userSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    color: this.color,
    createdAt: this.createdAt,
  };
};

export const User = mongoose.model('User', userSchema);
