import { Moon, Sun } from 'lucide-react';
import { useUiStore } from '../../store/uiStore.js';
import { IconButton } from './Button.jsx';

export function ThemeToggle() {
  const theme = useUiStore((s) => s.theme);
  const toggle = useUiStore((s) => s.toggleTheme);
  return <IconButton label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} icon={theme === 'dark' ? Sun : Moon} onClick={toggle} />;
}
