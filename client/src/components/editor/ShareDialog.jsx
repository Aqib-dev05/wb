import { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { boardService } from '../../services/board.service.js';
import { Avatar } from '../ui/Avatar.jsx';
import { Button, IconButton } from '../ui/Button.jsx';
import { Input } from '../ui/Input.jsx';
import { Modal } from '../ui/Modal.jsx';

const ROLE_LABEL = { owner: 'Owner', editor: 'Can edit', viewer: 'Can view' };

export function ShareDialog({ board, isOwner, onClose }) {
  const [members, setMembers] = useState(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setMembers(await boardService.members(board.id));
    } catch (err) {
      setError(err.message);
    }
  }, [board.id]);
  useEffect(() => { load(); }, [load]);

  const invite = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError('');
    try {
      const m = await boardService.addMember(board.id, email.trim(), role);
      setMembers((list) => [...(list ?? []), m]);
      setEmail('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const change = async (m, next) => {
    try {
      const updated = await boardService.setRole(board.id, m.userId, next);
      setMembers((list) => list.map((x) => (x.userId === m.userId ? updated : x)));
    } catch (err) { setError(err.message); }
  };
  const remove = async (m) => {
    try {
      await boardService.removeMember(board.id, m.userId);
      setMembers((list) => list.filter((x) => x.userId !== m.userId));
    } catch (err) { setError(err.message); }
  };

  return (
    <Modal title="Share board" onClose={onClose}>
      {isOwner && (
        <form onSubmit={invite} className="mb-4 flex items-start gap-2">
          <Input className="flex-1" aria-label="Email address" type="email" placeholder="Invite by email" value={email} onChange={(e) => { setEmail(e.target.value); setError(''); }} />
          <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)} className="h-10 rounded-lg border border-line bg-surface px-2 text-sm">
            <option value="editor">Can edit</option>
            <option value="viewer">Can view</option>
          </select>
          <Button type="submit" loading={busy}>Invite</Button>
        </form>
      )}
      {error && <p role="alert" className="mb-3 text-sm text-danger">{error}</p>}
      <ul className="max-h-72 space-y-1 overflow-y-auto">
        {!members && <li className="skeleton h-10 rounded-lg" />}
        {members?.map((m) => (
          <li key={m.userId} className="flex items-center gap-3 rounded-lg px-1 py-1.5">
            <Avatar user={{ name: m.name, color: m.color }} size={32} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{m.name}</p>
              {m.email && <p className="truncate text-xs text-muted">{m.email}</p>}
            </div>
            {isOwner && m.role !== 'owner' ? (
              <>
                <select aria-label={`Role for ${m.name}`} value={m.role} onChange={(e) => change(m, e.target.value)} className="h-8 rounded-lg border border-line bg-surface px-2 text-sm">
                  <option value="editor">Can edit</option>
                  <option value="viewer">Can view</option>
                </select>
                <IconButton label={`Remove ${m.name}`} icon={Trash2} onClick={() => remove(m)} />
              </>
            ) : (
              <span className="text-sm text-muted">{ROLE_LABEL[m.role]}</span>
            )}
          </li>
        ))}
      </ul>
    </Modal>
  );
}
