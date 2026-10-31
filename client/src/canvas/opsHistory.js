// Undo/redo as operations, not snapshots: each entry holds the ops that made a change and the ops
// that reverse it. Undoing therefore only touches *your* change and never rolls back other people's.
export class OpsHistory {
  constructor(limit = 100) {
    this.limit = limit;
    this.reset();
  }

  reset() {
    this.stack = [];
    this.index = -1; // points at the last applied entry
  }

  push(entry) {
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(entry);
    if (this.stack.length > this.limit) this.stack.shift();
    this.index = this.stack.length - 1;
  }

  /** Returns the ops that reverse the last change, or null. */
  undo() {
    if (!this.canUndo) return null;
    return this.stack[this.index--].inverse;
  }

  redo() {
    if (!this.canRedo) return null;
    return this.stack[++this.index].forward;
  }

  get canUndo() { return this.index >= 0; }
  get canRedo() { return this.index < this.stack.length - 1; }
}
