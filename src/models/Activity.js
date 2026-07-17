import mongoose from 'mongoose';

// Append-only activity timeline / audit log (Part 6).
const activitySchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      enum: [
        'DEAL_CREATED', 'DEAL_UPDATED', 'STAGE_CHANGED', 'RM_ASSIGNED',
        'TEAM_LEADER_ASSIGNED', 'NOTE_ADDED', 'LOGIN', 'LOGOUT',
        'USER_ACTION', 'API_EVENT',
      ],
    },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    actorName: String,
    entity: { type: String },       // e.g. 'deal'
    entityId: { type: mongoose.Schema.Types.ObjectId },
    detail: { type: mongoose.Schema.Types.Mixed }, // { field, old, new } etc.
    at: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false }
);

export const Activity = mongoose.model('Activity', activitySchema);

export async function logActivity(doc) {
  try { await Activity.create({ at: new Date(), ...doc }); }
  catch { /* never let audit logging break the request */ }
}
