import mongoose from 'mongoose';

const DEAL_STAGES = ['Assigned', 'Working', 'Meeting', 'Site Visit', 'FN', 'Closed Won', 'Closed Lost'];

const dealSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    name: { type: String, required: true, trim: true },
    stage: { type: String, enum: DEAL_STAGES, default: 'Assigned' },
    substatus: { type: String, default: 'Untouched' },
    // Owner == the Relationship Manager (RM).
    rm: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Auto-assigned from the RM's manager at creation time. Not client-editable.
    teamLeader: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    projectSales: String,
    budgetSales: String,
    citySales: String,
    localitySales: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export { DEAL_STAGES };
export const Deal = mongoose.model('Deal', dealSchema);
