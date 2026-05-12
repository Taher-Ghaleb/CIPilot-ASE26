import { Sun, Moon, Monitor } from 'lucide-react'
import { useTheme } from '../../context/ThemeContext'
import { Button } from './Button'
import type { Theme } from '../../types/settings'

interface ThemeToggleProps {
  showLabels?: boolean
  className?: string
}

export function ThemeToggle({ showLabels = false, className = '' }: ThemeToggleProps) {
  const { theme, setTheme, resolvedTheme } = useTheme()

  if (showLabels) {
    return (
      <div className={`flex items-center gap-1 p-1 rounded-xl bg-[var(--bg-glass)] ${className}`}>
        <ThemeButton
          currentTheme={theme}
          targetTheme="light"
          icon={<Sun className="w-4 h-4" />}
          label="Light"
          onClick={() => setTheme('light')}
        />
        <ThemeButton
          currentTheme={theme}
          targetTheme="dark"
          icon={<Moon className="w-4 h-4" />}
          label="Dark"
          onClick={() => setTheme('dark')}
        />
        <ThemeButton
          currentTheme={theme}
          targetTheme="system"
          icon={<Monitor className="w-4 h-4" />}
          label="System"
          onClick={() => setTheme('system')}
        />
      </div>
    )
  }

  // Simple toggle button
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      className={className}
      aria-label="Toggle theme"
    >
      {resolvedTheme === 'dark' ? (
        <Sun className="w-5 h-5" />
      ) : (
        <Moon className="w-5 h-5" />
      )}
    </Button>
  )
}

interface ThemeButtonProps {
  currentTheme: Theme
  targetTheme: Theme
  icon: React.ReactNode
  label: string
  onClick: () => void
}

function ThemeButton({ currentTheme, targetTheme, icon, label, onClick }: ThemeButtonProps) {
  const isActive = currentTheme === targetTheme

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
        isActive
          ? 'bg-primary-500 text-white'
          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-glass-hover)]'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
