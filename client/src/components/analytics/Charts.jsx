import { Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TYPE_COLORS, TYPE_LABELS, formatDay, formatHour, formatNumber, kindLabel } from '../../analytics/format.js';
import { ChartCard } from './ChartCard.jsx';

const AXIS = { tick: { fill: 'var(--muted)', fontSize: 12 }, axisLine: { stroke: 'var(--line)' }, tickLine: false };
const TOOLTIP = {
  contentStyle: { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, color: 'var(--ink)', fontSize: 13, boxShadow: 'var(--shadow-pop)' },
  labelStyle: { color: 'var(--ink)', fontWeight: 600 },
  itemStyle: { color: 'var(--ink)' },
  cursor: { fill: 'var(--surface-2)' },
};
const plural = (n, one, many = `${one}s`) => `${formatNumber(n)} ${n === 1 ? one : many}`;
const sum = (rows, key) => rows.reduce((s, r) => s + r[key], 0);

function DailyTooltip({ active, payload, label, noun }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div style={TOOLTIP.contentStyle} className="px-3 py-2">
      <p style={TOOLTIP.labelStyle}>{formatDay(label)}</p>
      <p>{noun(row)}</p>
    </div>
  );
}

export function SessionsPerDay({ daily, days }) {
  const total = sum(daily, 'sessions');
  return (
    <ChartCard
      title="Sessions per day"
      subtitle={`Times someone was on the board, last ${days} days. Viewing counts, editing is not required.`}
      empty={total === 0 ? 'No one was on this board in this period.' : null}
      summary={`${plural(total, 'session')} in the last ${days} days`}
      table={{ head: ['Day', 'Sessions'], rows: daily.map((d) => [formatDay(d.date), d.sessions]) }}
    >
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={daily} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="date" tickFormatter={formatDay} minTickGap={28} {...AXIS} />
          <YAxis allowDecimals={false} width={44} {...AXIS} />
          <Tooltip {...TOOLTIP} content={<DailyTooltip noun={(r) => plural(r.sessions, 'session')} />} />
          <Bar dataKey="sessions" fill="var(--primary)" radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function ActivePeoplePerDay({ daily, days }) {
  const peak = Math.max(0, ...daily.map((d) => d.activePeople));
  return (
    <ChartCard
      title="Active people per day"
      subtitle={`People who made at least one change that day, last ${days} days.`}
      empty={peak === 0 ? 'No changes were made in this period.' : null}
      summary={`Up to ${plural(peak, 'person', 'people')} made changes on a single day`}
      table={{ head: ['Day', 'People who made changes', 'Changes'], rows: daily.map((d) => [formatDay(d.date), d.activePeople, d.changes]) }}
    >
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={daily} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="date" tickFormatter={formatDay} minTickGap={28} {...AXIS} />
          <YAxis allowDecimals={false} width={44} domain={[0, Math.max(1, peak)]} {...AXIS} />
          <Tooltip {...TOOLTIP} content={<DailyTooltip noun={(r) => `${plural(r.activePeople, 'person', 'people')} · ${plural(r.changes, 'change')}`} />} />
          <Line type="monotone" dataKey="activePeople" stroke="var(--primary)" strokeWidth={2.5} dot={{ r: 3, fill: 'var(--primary)', strokeWidth: 0 }} activeDot={{ r: 5 }} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function OpsByType({ opsByType, createdByKind, total }) {
  const rows = opsByType.map((o) => ({ ...o, label: TYPE_LABELS[o.type] }));
  return (
    <ChartCard
      title="What people did"
      subtitle="Every recorded change, by kind."
      empty={total === 0 ? 'No changes recorded yet.' : null}
      summary={rows.map((r) => `${r.label}: ${r.count}`).join(', ')}
      table={{ head: ['Change', 'Count'], rows: rows.map((r) => [r.label, formatNumber(r.count)]) }}
    >
      <ResponsiveContainer width="100%" height={190}>
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 48, left: 0, bottom: 0 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="label" width={84} {...AXIS} />
          <Tooltip {...TOOLTIP} />
          <Bar dataKey="count" name="Changes" radius={[0, 4, 4, 0]} maxBarSize={26}>
            {rows.map((r) => <Cell key={r.type} fill={TYPE_COLORS[r.type]} />)}
            <LabelList dataKey="count" position="right" formatter={formatNumber} style={{ fill: 'var(--ink)', fontSize: 12 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {createdByKind.length > 0 && (
        <p className="mt-3 text-sm text-muted">
          <span className="font-medium text-ink">Objects created:</span> {createdByKind.map((k) => `${formatNumber(k.count)} ${kindLabel(k.kind).toLowerCase()}`).join(' · ')}
        </p>
      )}
    </ChartCard>
  );
}

const MAX_PEOPLE = 10;

export function Contribution({ users, total }) {
  const shown = users.slice(0, MAX_PEOPLE);
  const rows = shown.map((u) => ({ name: u.name, created: u.created, updated: u.updated, deleted: u.deleted, reordered: u.reordered, share: u.share, changes: u.changes }));
  return (
    <ChartCard
      title="Who made the changes"
      subtitle="Recorded changes per person, whole history. This counts edits, not effort or quality."
      empty={total === 0 ? 'No changes recorded yet.' : null}
      summary={shown.map((u) => `${u.name}: ${u.changes} changes`).join(', ')}
      table={{ head: ['Person', 'Changes', 'Share', 'Created', 'Edited', 'Deleted', 'Reordered'], rows: users.map((u) => [u.name, formatNumber(u.changes), `${Math.round(u.share * 100)}%`, u.created, u.updated, u.deleted, u.reordered]) }}
    >
      <ResponsiveContainer width="100%" height={Math.max(150, rows.length * 44 + 56)}>
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--line)" horizontal={false} />
          <XAxis type="number" allowDecimals={false} {...AXIS} />
          <YAxis type="category" dataKey="name" width={96} tickFormatter={(n) => (n.length > 13 ? `${n.slice(0, 12)}…` : n)} {...AXIS} />
          <Tooltip {...TOOLTIP} />
          <Legend iconType="circle" itemSorter={null} wrapperStyle={{ fontSize: 12, color: 'var(--muted)' }} />
          {Object.keys(TYPE_LABELS).map((type) => (
            <Bar key={type} dataKey={type} name={TYPE_LABELS[type]} stackId="changes" fill={TYPE_COLORS[type]} maxBarSize={24} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      {users.length > MAX_PEOPLE && <p className="mt-2 text-sm text-muted">Showing the {MAX_PEOPLE} most active of {users.length} people. The table has everyone.</p>}
    </ChartCard>
  );
}

export function BusiestHours({ hours, total, tzLabel }) {
  const rows = hours.map((count, hour) => ({ hour, count }));
  const peak = rows.reduce((best, r) => (r.count > best.count ? r : best), rows[0]);
  return (
    <ChartCard
      title="Busiest hours"
      subtitle={`Changes by hour of the day, whole history, in your time zone (${tzLabel}).`}
      empty={total === 0 ? 'No changes recorded yet.' : null}
      summary={`Most changes happen between ${formatHour(peak.hour)} and ${formatHour((peak.hour + 1) % 24)} (${peak.count})`}
      table={{ head: ['Hour', 'Changes'], rows: rows.map((r) => [`${formatHour(r.hour)}–${formatHour((r.hour + 1) % 24)}`, formatNumber(r.count)]) }}
      className="lg:col-span-2"
    >
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={rows} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="hour" tickFormatter={(h) => String(h).padStart(2, '0')} interval={2} {...AXIS} />
          <YAxis allowDecimals={false} width={44} {...AXIS} />
          <Tooltip {...TOOLTIP} labelFormatter={(h) => `${formatHour(h)}–${formatHour((h + 1) % 24)}`} formatter={(v) => [formatNumber(v), 'Changes']} />
          <Bar dataKey="count" radius={[3, 3, 0, 0]}>
            {rows.map((r) => <Cell key={r.hour} fill={r.hour === peak.hour && peak.count > 0 ? 'var(--primary)' : 'color-mix(in srgb, var(--primary) 45%, var(--surface))'} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
