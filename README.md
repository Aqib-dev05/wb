# CollabBoard

Real-time collaborative whiteboard with session replay and analytics.
**Status: Phases 1-6 done plus Phase 7 (notifications) — export, performance and accessibility pass, on top of analytics (Recharts dashboard + canvas heatmap), session recording/playback (Phase 4), real-time collaboration (Phase 3), the editor (Phase 2) and the foundation (Phase 1).**

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
| GET | /api/boards/:id/sessions | `?page=&limit=&includeEmpty=` recorded sessions, newest first, with participants — any member |
| GET | /api/boards/:id/sessions/:sessionId | one session plus who was present when (`presence` join/leave offsets) |
| GET | /api/boards/:id/sessions/:sessionId/events | `?after=<seq>&limit=` the session's changes in sequence order (cursor-paged) |
| GET | /api/boards/:id/sessions/:sessionId/state | `?t=<ms since session start>` the board as it was at that moment (`{ sequence, offsetMs, objects }`) |
| GET | /api/boards/:id/analytics | `?tz=<minutes east of UTC, multiple of 15>&days=7..60` interaction metrics for the board — any member (see below) |

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

## Session recording & playback (Phase 4)

**Recording.** A *session* is one continuous period in which someone is on a board. It starts when the first person joins the room and ends 30 s after the last one leaves (so a reconnect blip does not split it); its `endedAt` is the moment the last person actually left. Every accepted operation already lands in `BoardEvents`; Phase 4 tags each one with the `sessionId` (server clock, never the client's). `Sessions` hold start/end, the board sequence the session began from, and counters; `SessionParticipants` hold each user's join/leave times. If a session record cannot be written, editing carries on and the events are simply stored untagged. A crash can leave a session open: on startup it is closed from the last recorded event (`endReason: "recovered"`). A clean shutdown closes them with `shutdown`.

**Playback.** The board at any moment = nearest snapshot at or before the target sequence + only the events after it (never a replay from the start). Playback reads history through the endpoints above and never touches a live room, so watching cannot change the board. The client `PlaybackEngine` (`client/src/playback/`) is plain JS: seeking asks the server for the state at that moment, playing streams events in pages and applies each when the playback clock reaches the time it was recorded. It never runs ahead of events it has not received, and ignores a seek that was superseded by a newer one. Controls: play/pause (`Space`), scrubber, 0.5× / 1× / 1.5× / 2×, `←`/`→` ±5 s, `Home` restart. Open it from the history icon in the editor top bar or "Replay history" on a dashboard card (`/board/:id/replay/:sessionId?`).

**Limits to know about.** Playback shows the changes to the board (objects), not cursor movement or live drag previews — those are never stored. A session that is still live can be watched up to the moment it was opened. Text edits are recorded when committed, as in live sync. Sessions are kept forever for now (no retention policy yet). Only `eventCount` is stored per session; richer analytics come in Phase 5.

Tests: `cd server && npm test` (adds session lifecycle, snapshot-based state-at-sequence, paging/seek and crash recovery) and `cd client && npm test` (playback engine with a fake clock).

## Analytics (Phase 5)

Open it from the bar-chart icon in the editor top bar or "Analytics" on a dashboard card (`/board/:id/analytics`). Every member of a board can see it.

**What it shows.** KPIs (changes, people who made changes, sessions, time on the board); sessions per day; active people per day; changes by kind (created / edited / deleted / reordered) plus what was created (rectangles, sticky notes, ...); changes per person; busiest hours of the day; and a heatmap of *where on the board* changes happened. Every chart has a "View as table" with the exact numbers.

**What the numbers mean.** They are *interaction metrics*: counts of recorded changes and of times people were on the board. They are not engagement or attention: someone who only watches leaves no changes (they still count as a session), and cursor movement is never recorded. The page says so.

**How it is computed.** `analytics.reducer.js` is a pure function over `BoardEvents` (no clock, no I/O), so every figure is checked in tests against hand-computed fixtures. `analytics.service.js` reduces a board's history once and caches it in `AnalyticsAggregates` (one document per board, *replaced*, never incremented, so retries or concurrent refreshes cannot double-count). The cache is valid while the board's sequence is unchanged; after a change it is served for up to 5 s, then rebuilt (concurrent requests share one rebuild). It is also rebuilt daily and whenever `ANALYTICS_VERSION` is bumped. Time is bucketed in 15-minute UTC slots, so "day" and "hour of day" are exact for every real UTC offset (the client sends `tz`; sessions per day use the session's start day).

**Heatmap.** Each change is placed at the centre of the object it touched, using the object's last known position (a colour change or a delete has no position of its own). Rotation is ignored, so positions are approximate. Cells are 100x100 board pixels; the 5,000 busiest are kept and the page says how many changes the rest hold. Changes to objects whose creation is not in the log cannot be placed and are counted separately.

**Limits to know about.** The daily charts cover 7-60 days (the series is kept for 90); everything else is whole history. The viewer's *current* UTC offset is applied to the whole period, so days across a daylight-saving change can be off by an hour. A rebuild reads the board's whole event log, so the first request on a very large, never-analysed board is slow. Analytics are per board; there is no cross-board overview yet. Sessions with no edits are included in session counts.

Tests: `cd server && npm test` now also covers the reducer (10 tests on hand-computed fixtures) and the service (timezones including +5:30/+5:45, zero-filled days, sessions, caching, paging, real-socket events).

## Export, performance & accessibility (Phase 6)

**Export.** The download icon in the editor top bar exports the *whole board* (not just what is on screen) as PNG, transparent PNG or PDF. The image is cropped to the content plus 40 px of paper and rendered at 2x. Browsers cap canvas size (iOS Safari: 16.7 million pixels), so the scale is lowered for very large boards and the toast says what size you got. PDF is one page the size of the content with the rendered image embedded (so text is not selectable in the PDF); jsPDF is loaded only when you export a PDF. Viewers can export too. Exporting an empty board says so instead of producing a blank file.

**Performance.** Measured in Chromium with software rendering (no GPU), boards of 500 / 2,000 / 5,000 mixed shapes and scribbles, whole board in view: a pan frame took 123 / 533 / 1,432 ms with Fabric's per-object bitmap cache on and 4 / 18 / 40 ms with it off, so `objectCaching` is off for all objects (long scribbles measured the same way). Export of 5,000 objects went from 2.3 s to 70 ms. Still slow-ish at 5,000 objects: applying them in one go (0.9 s) and every local edit (the commit diffs the whole board: 100 ms at 5,000, 30 ms at 2,000). Server side: analytics over 50,000 events took 180 ms, a full replay of 60,000 events 0.9 s (recovery never does this: it starts from the latest snapshot).

**Board size limit.** A board's snapshot is one MongoDB document (16 MB limit), and BSON is about 2.2x the JSON size for stroke data. Without a limit, a very large drawing board would silently stop being snapshotted and every restart would replay a growing event log. The server now tracks the estimated BSON size (`bsonSize.js`, tested against the real BSON library) and refuses *new content* above 12 MB with reason `board_full`; deleting and moving still work, and the client shows "This board is full". Failed snapshots are retried at most every 30 s instead of on every write.

**Accessibility.** Checked with axe-core (WCAG 2.1 A/AA + best practices) on the editor, replay, analytics and dashboard shell in light and dark: 0 violations after fixing two colour tokens (muted text 4.2:1 and brand text in dark mode 3.8:1, both now above 4.5:1) and adding a landmark for the canvas. Menus follow the menu-button pattern (arrow keys, Home/End, Escape returns focus); dialogs move focus in, keep Tab inside and restore focus on close. Board shortcuts are ignored inside menus and dialogs (arrow keys used to nudge the selected object while navigating a menu). Sync errors (failed save, change not accepted) used to be stored but never shown; they now appear as a toast. Axe cannot judge everything: the canvas itself is a pointer-driven drawing surface and has no keyboard drawing mode, and screen-reader use of the board content is not supported.

**Not verified.** Everything Mongo-backed (Phases 4-6 queries, `board_full` against a real 16 MB document) has not run against a live MongoDB. Performance numbers come from a headless Chromium without a GPU; real devices will differ (relative differences are the useful part). No real-device or screen-reader testing.

Tests: server 56 (8 new: BSON size vs the real library, byte tracking, `board_full`, snapshot back-off), client 19 (6 new: export sizing and file names).

## Notifications (Phase 7)

When the board owner adds someone by email, changes their access, or removes them, that person gets an in-app notification: a bell with an unread badge in the dashboard header and the editor top bar, a toast if they are online, and a list (newest first, "Show older", "Mark all as read"). Clicking a notice opens the board and marks it read.

**How it works.** The notice is saved first (`Notifications` collection, 9th; copies the board title and actor name so it still reads right after a rename; expires after 90 days; removed with the board) and pushed second over a per-person socket room (`user:<id>`, every open tab/device gets it). A person who was offline, or whose push was lost, finds it in the list on the next load; the tab also reloads the list after a reconnect. You are never notified about your own actions (leaving a board, inviting yourself). A notification failure never fails the invite. API: `GET /api/notifications?limit=&before=` (cursor paging, returns `unread`) and `POST /api/notifications/read` (`{ids}` or `{all:true}`, only your own).

**Limits.** Invites add an existing account directly (no email, no pending/accept step), so the notice is informational. No email or push notification outside the app. Mongo-backed queries are not verified against a live MongoDB (tests use the in-memory store; the Chrome run used the real routes with stubbed models).

Tests: server 62 (6 new: persistence + push, self-skip, paging, mark read isolation, cleanup on board delete, per-user socket delivery). Checked in Chrome with two users: live badge and toast, list, open board, persistence across reload, notice delivered while away, role change and removal wording, mobile layout.

## Shapes, icons & logos library (Phase 8)

Open it from the grid button in the tool palette (or press `I`). Search works across all three groups:
`fb`, `insta`, `react`, `tailwind`, `laptop`, `server`, `router`, `pc`, `db` and similar short names are understood.

- **Shapes** (32, hand-drawn paths): flowchart shapes, polygons, block arrows, cloud, cylinder, etc.
- **Icons** (2,000+): [Lucide](https://lucide.dev), covering devices, servers, networking, files, UI.
- **Logos** (3,400+): [Simple Icons](https://simpleicons.org) (CC0), loaded lazily on first open.

Every item lands on the board as an ordinary Fabric `Path` with a `kind` of `shape`, `icon` or `logo`, so there is no
server schema change: it syncs, replays, exports and shows up in analytics like any other object. Properties differ by
kind (icons: stroke; logos: one colour; shapes: fill + stroke). Items that would exceed the 200 KB object limit are refused.

Known limits: Simple Icons has dropped a few brands for legal reasons (LinkedIn, AWS, Microsoft, Slack, Windows are
not available). Logos are trademarks of their owners; view-only members cannot open the library.

## Live video & voice calls (Phase 9)

Click the camera button in the top bar: **Join with camera and mic**, **mic only**, or **listen and watch**. Everybody on the board
(including view-only members) can join. The button shows how many people are in the call right now, live, even if you are not.
Your tile shows mic/camera state for everyone; mute and camera toggles work without renegotiating the connection.

How it works: a WebRTC **mesh**. Each participant connects directly to every other one; audio and video never pass through this server.
Socket.IO only carries signalling (`call:join`, `call:signal`, `call:media`, `call:leave`, `call:peer-joined|left`, `call:count`).
The server keeps the roster, only relays between two members of the same call, validates and size-limits every message, and removes
you from the call when you leave the board, lose connection, or are removed from the board. After a dropped connection the client
rejoins by itself. Closing the board page releases the camera and microphone.

Things to know:
- **Mesh = small groups.** Each person uploads one copy of their video per participant, so the call is capped at 6 people (`MAX_CALL_PEERS`).
  Bigger calls would need an SFU (LiveKit, mediasoup).
- **Networks.** STUN works for most home/office networks. Behind strict NATs or firewalls, calls need a TURN relay: set `TURN_URLS` plus
  `TURN_SECRET` (coturn `use-auth-secret`) or `TURN_USERNAME`/`TURN_CREDENTIAL` (see `server/.env.example`). Without TURN some pairs of people
  will show "Can't connect". Browsers only allow camera/mic on HTTPS or `localhost`.
- No recording, screen sharing or chat in the call yet.
