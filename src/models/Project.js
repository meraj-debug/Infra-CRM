import mongoose from 'mongoose';

const projectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    developer: String,
    sector: String,
    city: String,
    locality: String,
    status: { type: String, default: 'Under Construction' },
    rera: String,
    description: String,
    configs: { type: Array, default: [] },
    plans: { type: Array, default: [] },
    fbForms: { type: Array, default: [] },
  },
  { timestamps: true, strict: false, minimize: false }
);

export const Project = mongoose.model('Project', projectSchema);
