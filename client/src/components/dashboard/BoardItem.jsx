import { useNavigate } from 'react-router-dom';
import { MoreHorizontal, Pencil, Trash2, ExternalLink, History, BarChart3 } from 'lucide-react';
import { timeAgo } from '../../utils/format.js';
import { AvatarStack } from '../ui/Avatar.jsx';
import { IconButton } from '../ui/Button.jsx';
import { Menu } from '../ui/Menu.jsx';
import { BoardThumbnail } from './BoardThumbnail.jsx';

function useBoardMenu(board, { onRename, onDelete }) {
  const navigate = useNavigate();
  return [
    { label: 'Open', icon: ExternalLink, onSelect: () => navigate(`/board/${board.id}`) },
    { label: 'Replay history', icon: History, onSelect: () => navigate(`/board/${board.id}/replay`) },
    { label: 'Analytics', icon: BarChart3, onSelect: () => navigate(`/board/${board.id}/analytics`) },
    { label: 'Rename', icon: Pencil, onSelect: () => onRename(board), hidden: board.role === 'viewer' },
    { label: 'Delete', icon: Trash2, onSelect: () => onDelete(board), danger: true, hidden: board.role !== 'owner' },
  ];
}

const MoreMenu = ({ items }) => (
  <Menu items={items} trigger={() => <IconButton label="Board actions" icon={MoreHorizontal} className="h-8 w-8" />} />
);

const ownerLabel = (b) => (b.role === 'owner' ? 'You' : b.owner?.name || 'Unknown');

export function BoardCard({ board, ...handlers }) {
  const navigate = useNavigate();
  const items = useBoardMenu(board, handlers);
  return (
    <article
      onClick={() => navigate(`/board/${board.id}`)}
      className="group cursor-pointer overflow-hidden rounded-2xl border border-line bg-surface shadow-card transition hover:-translate-y-0.5 hover:border-primary/40"
    >
      <div className="aspect-[16/10] border-b border-line">
        <BoardThumbnail board={board} />
      </div>
      <div className="flex items-start gap-2 p-4">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-medium">
            <a href={`/board/${board.id}`} onClick={(e) => e.preventDefault()} className="focus-visible:outline-offset-4">{board.title}</a>
          </h3>
          <p className="mt-0.5 truncate text-xs text-muted">{ownerLabel(board)} · edited {timeAgo(board.lastModifiedAt)}</p>
        </div>
        <MoreMenu items={items} />
      </div>
      <div className="flex items-center justify-between px-4 pb-4">
        <AvatarStack users={board.members} total={board.memberCount} />
        {board.role !== 'owner' && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">{board.role}</span>}
      </div>
    </article>
  );
}

export function BoardRow({ board, ...handlers }) {
  const navigate = useNavigate();
  const items = useBoardMenu(board, handlers);
  return (
    <div
      onClick={() => navigate(`/board/${board.id}`)}
      className="flex cursor-pointer items-center gap-4 rounded-xl border border-line bg-surface p-3 transition hover:border-primary/40"
    >
      <div className="hidden h-14 w-24 shrink-0 overflow-hidden rounded-lg border border-line sm:block">
        <BoardThumbnail board={board} />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-medium">{board.title}</h3>
        <p className="truncate text-xs text-muted">{ownerLabel(board)}</p>
      </div>
      <span className="hidden w-32 text-sm text-muted md:block">{timeAgo(board.lastModifiedAt)}</span>
      <div className="hidden sm:block"><AvatarStack users={board.members} total={board.memberCount} /></div>
      <MoreMenu items={items} />
    </div>
  );
}
