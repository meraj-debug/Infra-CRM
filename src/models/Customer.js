import mongoose from 'mongoose';

// Pre-Sales object. Kept deliberately loose (strict:false) so every field the
// frontend puts on a customer survives a round-trip without a schema change.
const customerSchema = new mongoose.Schema(
  {
    // The CRM's own identifier ('c136201'), NOT the ObjectId. Deals, tasks and
    // activities all reference customers by this string, so it stays the key
    // callers use — migrating to ObjectIds would mean rewriting every
    // cross-reference in the snapshot at once.
    id: { type: String, required: true, unique: true, index: true },

    name: { type: String, required: true, trim: true },
    mobile: { type: String, trim: true, index: true },
    email: { type: String, trim: true, lowercase: true },
    campaign: String,
    source: String,
    subSource: String,
    projectMkt: String,
    cityMkt: String,
    budgetMkt: String,
    stage: { type: String, default: 'New' },
    leadStatus: { type: String, default: 'New' },
    // Ownership is by full name, matching the snapshot and the UI's mine().
    owner: { type: String, index: true },
    manager: String,
    ba: { type: String, index: true },
    cityMRC: String,
    citySales: String,
    remarks: String,

    // Append-only trails. Kept as subdocuments so a note added by one user
    // merges with a note added by another instead of racing over one blob.
    activities: { type: [mongoose.Schema.Types.Mixed], default: [] },
    notes: { type: [mongoose.Schema.Types.Mixed], default: [] },
    comms: { type: [mongoose.Schema.Types.Mixed], default: [] },
    audit: { type: [mongoose.Schema.Types.Mixed], default: [] },
    chatter: { type: [mongoose.Schema.Types.Mixed], default: [] },

    lastModifiedBy: String,
  },
  { timestamps: true, strict: false, minimize: false }
);

// The list view sorts newest-first within a scope; these back that query.
customerSchema.index({ owner: 1, createdAt: -1 });
customerSchema.index({ cityMRC: 1, createdAt: -1 });

export const Customer = mongoose.model('Customer', customerSchema);
