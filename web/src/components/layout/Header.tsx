import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Settings, Home, History, Menu, Github, Plane, Shield } from 'lucide-react'
import { Button, ThemeToggle } from '../common'
import { SettingsModal } from '../settings/SettingsModal'
import { useReviewer } from '../../context/ReviewerContext'

interface HeaderProps {
  onMenuClick?: () => void
  showMenuButton?: boolean
}

export function Header({ onMenuClick, showMenuButton = false }: HeaderProps) {
  const location = useLocation()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { isReviewer, reviewer, provider } = useReviewer()

  const navItems = [
    { path: '/', label: 'Home', icon: Home },
    { path: '/history', label: 'History', icon: History },
  ]

  return (
    <>
      <header className="sticky top-0 z-40 glass border-b border-[var(--border)]">
        <div className="flex">
          {/* Sidebar spacer - hidden on mobile, matches sidebar width on desktop */}
          <div className="hidden lg:block w-72 flex-shrink-0" />
          
          {/* Main header content */}
          <div className="flex-1 px-4 sm:px-6 lg:px-8">
            <div className="max-w-6xl mx-auto">
              <div className="flex items-center justify-between h-16">
            {/* Left: Logo + Mobile Menu */}
            <div className="flex items-center gap-4">
              {showMenuButton && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onMenuClick}
                  className="lg:hidden"
                >
                  <Menu className="w-5 h-5" />
                </Button>
              )}
              <Link to="/" className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center">
                  <Plane className="w-5 h-5 text-white" style={{ transform: 'rotate(-45deg)' }} />
                </div>
                <span className="text-xl font-bold text-[var(--text-primary)] hidden sm:block">
                  CIPilot
                </span>
              </Link>
            </div>

            {/* Center: Navigation (desktop) */}
            <nav className="hidden md:flex items-center gap-1">
              {navItems.map((item) => {
                const Icon = item.icon
                const isActive = location.pathname === item.path
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                      isActive
                        ? 'bg-primary-500/10 text-primary-500'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-glass)]'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {item.label}
                  </Link>
                )
              })}
            </nav>

            {/* Right: Actions */}
            <div className="flex items-center gap-2">
              {/* Reviewer Badge */}
              {isReviewer && reviewer && (
                <div 
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 border border-amber-500/30 rounded-lg"
                  title={`Reviewer: ${reviewer.name}\nProvider: ${provider?.name?.toUpperCase()} - ${provider?.model}`}
                >
                  <Shield className="w-4 h-4 text-amber-500" />
                  <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                    Reviewer
                  </span>
                </div>
              )}
              <ThemeToggle />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSettingsOpen(true)}
                aria-label="Settings"
                data-tour="settings-button"
              >
                <Settings className="w-5 h-5" />
              </Button>
              <a
                href="https://github.com/nazhoscse/cipilot"
                target="_blank"
                rel="noopener noreferrer"
                className="hidden sm:flex"
              >
                <Button variant="ghost" size="icon" aria-label="GitHub">
                  <Github className="w-5 h-5" />
                </Button>
              </a>
            </div>
          </div>
        </div>
        </div>
        </div>

        {/* Mobile Navigation */}
        <div className="flex md:hidden">
          <div className="hidden lg:block w-72 flex-shrink-0" />
          <nav className="flex-1 border-t border-[var(--border)] px-4 py-2">
          <div className="flex items-center gap-1">
            {navItems.map((item) => {
              const Icon = item.icon
              const isActive = location.pathname === item.path
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-primary-500/10 text-primary-500'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </Link>
              )
            })}
          </div>
        </nav>
        </div>
      </header>

      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  )
}
