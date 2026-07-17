import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true },
    fullName: { type: String, required: true, trim: true },
    profile: { type: String, default: 'Sales Executive (RM)' },
    role: { type: String, default: 'sales' },
    // Reporting manager == the Team Leader used for auto-assignment on deal creation.
    manager: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    city: { type: String, default: 'All' },
    email: { type: String, trim: true, lowercase: true },
    // NOTE: store a HASH here (bcrypt/argon2), never a plaintext password.
    passwordHash: { type: String, required: true, select: false },
  },
  { timestamps: true }
);

export const User = mongoose.model('User', userSchema);
