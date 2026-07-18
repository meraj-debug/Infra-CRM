import mongoose from 'mongoose';

/**
 * Permanent server-side replacement for the browser's IndexedDB store.
 *
 * The frontend used a single key/value object store ("state") and wrote one
 * key: "db", holding the whole CRM snapshot (customers, deals, bookings,
 * projects, tasks, users, V6 config, V7 incentive policy...).
 *
 * We keep exactly that contract so the frontend logic is unchanged — only the
 * transport moves from IndexedDB to Mongo.
 */
const stateSchema = new mongoose.Schema(
  {
    // Workspace/tenant bucket. Single-tenant deploys use 'default'.
    workspace: { type: String, required: true, default: 'default', index: true },
    // The old IndexedDB key, e.g. 'db'.
    key: { type: String, required: true },
    // The snapshot itself. Mixed = store the JSON verbatim, no shape coupling,
    // so future frontend fields persist without a backend migration.
    value: { type: mongoose.Schema.Types.Mixed, default: null },
    // Optimistic-concurrency counter: bumped on every write.
    rev: { type: Number, default: 0 },
    updatedByName: { type: String, default: '' },
  },
  { timestamps: true, minimize: false }
);

stateSchema.index({ workspace: 1, key: 1 }, { unique: true });

export const State = mongoose.model('State', stateSchema);
