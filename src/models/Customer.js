import mongoose from 'mongoose';

// Pre-Sales object. Kept deliberately loose (strict:false) so every field the
// frontend puts on a customer survives a round-trip without a schema change.
const customerSchema = new mongoose.Schema(
  {
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
    owner: String,
    ba: String,
    remarks: String,
  },
  { timestamps: true, strict: false, minimize: false }
);

export const Customer = mongoose.model('Customer', customerSchema);
