# CollabBoard

Real-time collaborative whiteboard with session replay and analytics.
**Status: Phase 2 of 6 done — editor (Fabric.js canvas, tools, undo/redo, autosave) on top of the Phase 1 foundation.**

## Run locally

Requires Node 20+ and a MongoDB instance (local or Atlas).

```bash
# API
cd server && cp .env.example .env     # fill in MONGODB_URI and two JWT secrets
npm install && npm run dev            # http://localhost:5000

# Web (second terminal)
cd client && npm install && npm run dev   # http://localhost:5173 (proxies /api to :5000)
```

No local MongoDB? `npm run dev:memory` in `server/` starts the API on a throwaway in-memory database
(it downloads a MongoDB binary on first run, so it needs internet access).

## API contract

Success: `{ "success": true, "data": {...}, "meta"?: {...} }`
Failure: `{ "success": false, "error": { "code", "message", "details"? } }`

| Method | Path | Notes |
|---|---|---|
| POST | /api/auth/register, /login | sets httpOnly refresh cookie, returns access token |
| POST | /api/auth/refresh, /logout | refresh rotates the token; reuse revokes all sessions |
| GET/PATCH | /api/auth/me | profile |
| GET/POST | /api/boards | `?q=&scope=all\|recent\|owned\|shared&page=&limit=` |
| GET/PATCH/DELETE | /api/boards/:id | role-checked (viewer < editor < owner); non-members get 404 |
| GET | /api/boards/:id/state | `{ objects, sequence }` live state — any member (the editor itself joins over the socket) |
| PUT | /api/boards/:id/thumbnail | `{ thumbnail }` base64 image (≤ 400 KB) — editor or owner |
| GET/POST/PATCH/DELETE | /api/boards/:id/members | owner manages roles (`editor`/`viewer`); removal also cuts the live socket |

## Editor

Shortcuts: `V` select · `H` hand (or hold `Space`) · `P` pen · `R` rect · `O` ellipse · `G` triangle · `L` line · `A` arrow · `T` text · `N` sticky ·
`Ctrl+Z` / `Ctrl+Shift+Z` undo/redo · `Ctrl+C/X/V/D` copy/cut/paste/duplicate · `Del` delete · `[` `]` send back/bring front ·
arrows nudge (Shift = 10px) · `Ctrl+wheel` zoom · wheel pans · `+` `-` `0` zoom · `Shift+1` fit to content · double-click a sticky to edit.

Canvas code lives in `client/src/canvas/` and is independent of React: `CanvasController` is the only thing that touches Fabric.
Every finished edit goes through `controller.commit()`, which records history and signals autosave (and, in Phase 3, sync).

## Real-time collaboration (Phase 3)

The editor no longer saves whole boards over REST. It joins a Socket.IO room per board and exchanges **operations**.

| Event | Direction | Notes |
| --- | --- | --- |
| `board:join` (ack) | C→S | Server checks membership. Returns role, participants, and either a delta (`ops` after `lastSeq`) or the full state. |
| `ops:submit` (ack) | C→S | A batch of `object:created / updated / deleted / reordered`. The ack carries the assigned sequence range and any rejected ops. |
| `ops:applied` | S→others | Accepted ops with `seq`, plus `prev` so clients can detect a missed batch. |
| `cursor:moved`, `object:transient` | both | Volatile; never stored, dropped under load. |
| `user:joined`, `user:left`, `board:role`, `board:kicked`, `board:deleted` | S→C | Presence and access changes. |

**Ordering and conflicts.** Per board, the server processes batches one at a time. Each accepted op gets a sequence number from an atomic `$inc` on the board and is stored in `BoardEvents` *before* it is applied and broadcast. Resolution: last-writer-wins per property (by sequence), delete beats update, creating an existing id is a no-op, and z-order is anchored to a neighbour id. The model is operation-based so a CRDT could replace the policy later.

**Client.** A "shadow" copy of the last synced state is diffed against the canvas to produce forward and inverse ops. Remote ops update canvas and shadow together, so they are never echoed back. Undo/redo replays inverse ops and does not roll back other people's work. Unacknowledged batches are kept and resent after reconnect; batch ids make resending safe.

**Recovery.** Snapshots are written every 200 events, after 15 s idle and when a room empties. Loading a board = latest snapshot + later events.

**Limits to know about.** One server process owns each active board (scaling out needs sticky routing or a Redis-backed queue). Text edits sync when committed, not per keystroke. Live drag previews are best-effort.

Tests: `cd server && npm test` (state machine, validation, and real Socket.IO integration over an in-memory store).
