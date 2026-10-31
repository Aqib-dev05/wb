import { Logo } from '../ui/Logo.jsx';
import { ThemeToggle } from '../ui/ThemeToggle.jsx';

// The one memorable moment: a miniature board with sticky notes and named cursors drifting,
// i.e. the product's own vocabulary rather than a generic gradient hero.
function BoardPreview() {
  return (
    <div className="dot-grid relative h-full min-h-[420px] overflow-hidden rounded-3xl border border-line bg-surface" aria-hidden="true">
      <div className="anim-drift-a absolute left-[8%] top-[10%] w-40 -rotate-3 rounded-md bg-sticky p-4 text-sm font-medium text-[#3a3000] shadow-card">
        Ship the onboarding flow
      </div>
      <div className="anim-drift-b absolute right-[10%] top-[22%] w-36 rotate-2 rounded-md bg-[#b9f0d8] p-4 text-sm font-medium text-[#0d3b28] shadow-card">
        Retro: what worked?
      </div>
      <div className="anim-drift-c absolute bottom-[14%] left-[22%] w-44 rotate-1 rounded-md bg-[#ffd0c9] p-4 text-sm font-medium text-[#5a1a10] shadow-card">
        Heatmap for the review
      </div>
      <div className="anim-drift-b absolute left-[44%] top-[44%]">
        <Cursor color="#5B4BFF" name="Maya" />
      </div>
      <div className="anim-drift-a absolute right-[16%] bottom-[24%]">
        <Cursor color="#FF6B57" name="Jonas" />
      </div>
    </div>
  );
}

function Cursor({ color, name }) {
  return (
    <div className="flex items-start gap-1">
      <svg width="18" height="18" viewBox="0 0 18 18"><path d="M2 2l12 5-5 1.8L7 14z" fill={color} /></svg>
      <span className="mt-3 rounded-full px-2.5 py-0.5 text-xs font-semibold text-white" style={{ background: color }}>{name}</span>
    </div>
  );
}

export function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="grid min-h-full lg:grid-cols-[minmax(420px,520px)_1fr]">
      <div className="flex flex-col px-6 py-6 sm:px-12">
        <header className="flex items-center justify-between">
          <Logo />
          <ThemeToggle />
        </header>
        <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h1 className="font-display text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm text-muted">{subtitle}</p>
          <div className="mt-8">{children}</div>
          <div className="mt-6 text-sm text-muted">{footer}</div>
        </main>
      </div>
      <div className="hidden p-4 lg:block">
        <BoardPreview />
      </div>
    </div>
  );
}
