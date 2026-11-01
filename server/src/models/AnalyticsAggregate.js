import mongoose from 'mongoose';

// Cached result of analytics.reducer over a board's events. One document per board, REPLACED (never
// incremented) on refresh, so a retry or a concurrent refresh cannot double-count anything.
// `sequence` is the board sequence the result covers; `version` invalidates it when the maths change.
// It is derived data: deleting it only costs a recompute from BoardEvents.
const analyticsAggregateSchema = new mongoose.Schema(
  {
    boardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Board', required: true },
    version: { type: Number, required: true },
    sequence: { type: Number, required: true },
    computedAt: { type: Date, required: true },
    data: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { versionKey: false, minimize: false }
);

analyticsAggregateSchema.index({ boardId: 1 }, { unique: true });

export const AnalyticsAggregate = mongoose.model('AnalyticsAggregate', analyticsAggregateSchema);
