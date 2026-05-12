import { CheckCircle2, AlertCircle } from 'lucide-react'
import type { DetectedService } from '../../types/migration'

interface CIServiceChipsProps {
  services: DetectedService[]
  selectedServices?: string[]
  onToggle?: (serviceName: string) => void
  selectable?: boolean
}

// CI service icons/colors - matches Chrome extension keyCIConfigs
const serviceConfig: Record<string, { color: string; icon: string }> = {
  'GitHub Actions': { color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400', icon: '⚡' },
  'Travis CI': { color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400', icon: '🔴' },
  CircleCI: { color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400', icon: '🟢' },
  AppVeyor: { color: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400', icon: '🔷' },
  'GitLab CI': { color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400', icon: '🦊' },
  Semaphore: { color: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400', icon: '🚦' },
  Buildkite: { color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400', icon: '🏗️' },
  'Azure Pipelines': { color: 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-400', icon: '☁️' },
  'Bitbucket Pipelines': { color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400', icon: '🪣' },
  'Cirrus CI': { color: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400', icon: '🌀' },
  'Scrutinizer CI': { color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400', icon: '🔍' },
  Codeship: { color: 'bg-lime-100 text-lime-800 dark:bg-lime-900/30 dark:text-lime-400', icon: '🚀' },
  Wercker: { color: 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400', icon: '🔧' },
  Bitrise: { color: 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/30 dark:text-fuchsia-400', icon: '📱' },
  Bamboo: { color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400', icon: '🎋' },
  GoCD: { color: 'bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-400', icon: '🔄' },
  Codemagic: { color: 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-400', icon: '✨' },
  Jenkins: { color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400', icon: '🤖' },
  'Drone CI': { color: 'bg-stone-100 text-stone-800 dark:bg-stone-900/30 dark:text-stone-400', icon: '🐝' },
  default: { color: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300', icon: '⚙️' },
}

export function CIServiceChips({
  services,
  selectedServices = [],
  onToggle,
  selectable = false,
}: CIServiceChipsProps) {
  if (services.length === 0) {
    return (
      <div className="flex items-center gap-2 text-[var(--text-muted)]">
        <AlertCircle className="w-4 h-4" />
        <span className="text-sm">No CI/CD services detected</span>
      </div>
    )
  }

  const getServiceStyle = (serviceName: string) => {
    return serviceConfig[serviceName] || serviceConfig.default
  }

  // Separate GitHub Actions (target) from other services (sources)
  const isGitHubActions = (name: string) => name === 'GitHub Actions'
  const sourceServices = services.filter(s => !isGitHubActions(s.name))
  const hasGitHubActions = services.some(s => isGitHubActions(s.name))

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-[var(--text-primary)]">Detected CI Services</span>
        <span className="text-xs text-[var(--text-muted)]">({services.length})</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {/* Source services (selectable - single selection only) */}
        {sourceServices.map((service) => {
          const config = getServiceStyle(service.name)
          const isSelected = selectedServices.includes(service.name)

          return (
            <button
              key={service.name}
              onClick={() => selectable && onToggle?.(service.name)}
              disabled={!selectable}
              className={`
                inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium
                transition-all duration-200
                ${isSelected
                  ? 'bg-primary-500 text-white ring-2 ring-primary-500 ring-offset-2 dark:ring-offset-gray-900'
                  : config.color}
                ${selectable ? 'cursor-pointer hover:scale-105' : 'cursor-default'}
              `}
            >
              <span>{config.icon}</span>
              <span>{service.name}</span>
              {isSelected && <CheckCircle2 className="w-3.5 h-3.5" />}
            </button>
          )
        })}

        {/* GitHub Actions (target - not selectable, shown differently) */}
        {hasGitHubActions && (
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium
              bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400
              border-2 border-dashed border-green-400"
            title="GitHub Actions is the target platform - migration destination"
          >
            <span>⚡</span>
            <span>GitHub Actions</span>
            <span className="text-xs font-bold">(target)</span>
          </div>
        )}
      </div>

      {selectable && sourceServices.length > 0 && (
        <p className="text-xs text-[var(--text-muted)]">
          Select ONE source CI service to migrate to GitHub Actions
        </p>
      )}
      {!selectable && (
        <p className="text-xs text-[var(--text-muted)]">
          Found {services.length} CI configuration{services.length > 1 ? 's' : ''}
        </p>
      )}
    </div>
  )
}
