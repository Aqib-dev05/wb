import mongoose from 'mongoose';

// A session = one continuous period during which a board had at least one participant connected.
// It starts when the first person joins the board's room and ends once the room has been empty
// for `sessionGraceMs` (so a reconnect blip does not split one working session into many).
//
// Playback needs only: startedAt/endedAt (the timeline), startSequence (the board state the session
// began from) and the events tagged with this session's id. Counters are written when the session
// ends; for a session that is still open (or one a crash left open) they are derived from BoardEvents.
const sessionSchema = new mongoose.Schema(
  {
    boardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Board', required: true },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, default: null }, // null while open
    // idle: room stayed empty past the grace period · shutdown: server stopped cleanly
    // recovered: server crashed; endedAt is the last recorded activity, a lower bound
    endReason: { type: String, enum: ['idle', 'shutdown', 'recovered', null], default: null },
    startSequence: { type: Number, required: true, default: 0 }, // board sequence when the session began
    endSequence: { type: Number, default: null },
    eventCount: { type: Number, default: 0 },
    lastEventAt: { type: Date, default: null },
  },
  { versionKey: false }
);

sessionSchema.index({ boardId: 1, startedAt: -1 });
sessionSchema.index({ endedAt: 1 }); // finds sessions a crash left open

export const Session = mongoose.model('Session', sessionSchema);
