/** A titled card around one chart, with an empty state and a plain-table alternative for screen readers and for exact numbers. */
export function ChartCard({ title, subtitle, empty, summary, table, className = '', children }) {
  return (
    <section aria-label={title} className={`min-w-0 rounded-2xl border border-line bg-surface p-5 shadow-card ${className}`}>
      <h2 className="font-display text-base font-semibold tracking-tight">{title}</h2>
      {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      <div className="mt-4">
        {empty ? (
          <p className="flex h-40 items-center justify-center rounded-xl bg-surface-2 px-4 text-center text-sm text-muted">{empty}</p>
        ) : (
          <>
            <div role="img" aria-label={summary ?? title}>{children}</div>
            {table && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-muted hover:text-ink">View as table</summary>
                <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-line">
                  <table className="w-full text-left tabular-nums">
                    <thead className="sticky top-0 bg-surface-2 text-xs text-muted">
                      <tr>{table.head.map((h) => <th key={h} scope="col" className="px-3 py-1.5 font-medium">{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {table.rows.map((row, i) => (
                        <tr key={i} className="border-t border-line">{row.map((cell, j) => <td key={j} className="px-3 py-1.5">{cell}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </section>
  );
}
