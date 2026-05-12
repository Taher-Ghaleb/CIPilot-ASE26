import { useState, useCallback, useEffect } from 'react'
import Editor from '@monaco-editor/react'
import { Copy, Check, FileCode, ExternalLink } from 'lucide-react'
import { Button, Card, Select } from '../common'
import { useTheme } from '../../context/ThemeContext'
import { useToast } from '../../context/ToastContext'

interface OriginalFile {
  name: string
  content: string
  service: string
  url?: string
}

interface DiffViewerProps {
  originalFiles: OriginalFile[]
  convertedYaml: string
  onYamlChange: (yaml: string) => void
  readOnly?: boolean
  showOnlyOriginal?: boolean
  defaultSelectedService?: string
}

export function DiffViewer({
  originalFiles,
  convertedYaml,
  onYamlChange,
  readOnly = false,
  showOnlyOriginal = false,
  defaultSelectedService,
}: DiffViewerProps) {
  const { resolvedTheme } = useTheme()
  const toast = useToast()
  
  // Find the index of the default selected service, or default to 0
  const getDefaultIndex = useCallback(() => {
    if (defaultSelectedService && originalFiles.length > 0) {
      // Match by exact service name or by service prefix (for "CircleCI:.circleci/config.yml" format)
      const index = originalFiles.findIndex(file => {
        const fileService = file.service.includes(':') ? file.service.split(':')[0] : file.service
        return fileService === defaultSelectedService || file.service === defaultSelectedService
      })
      return index >= 0 ? index : 0
    }
    return 0
  }, [defaultSelectedService, originalFiles])
  
  const [selectedFileIndex, setSelectedFileIndex] = useState(() => getDefaultIndex())
  const [copied, setCopied] = useState(false)

  // Update selected file when defaultSelectedService or originalFiles change
  useEffect(() => {
    const newIndex = getDefaultIndex()
    setSelectedFileIndex(newIndex)
  }, [getDefaultIndex])

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(convertedYaml)
      setCopied(true)
      toast.success('Copied to clipboard')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Failed to copy')
    }
  }, [convertedYaml, toast])

  const selectedFile = originalFiles[selectedFileIndex]
  const editorTheme = resolvedTheme === 'dark' ? 'vs-dark' : 'light'

  // Extract service name from service field (handles "ServiceName" or "ServiceName:filename" format)
  const getServiceName = (serviceField: string) => {
    return serviceField.includes(':') ? serviceField.split(':')[0] : serviceField
  }

  const fileOptions = originalFiles.map((file, index) => ({
    value: index.toString(),
    label: `${getServiceName(file.service)}: ${file.name}`,
  }))

  // If showing only original, use single column layout
  if (showOnlyOriginal) {
    return (
      <Card variant="glass" padding="none" className="overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <FileCode className="w-4 h-4 text-[var(--text-muted)]" />
            <span className="text-sm font-medium text-[var(--text-primary)]">Source Configuration</span>
            <span className="px-2 py-0.5 rounded text-xs bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300">
              {selectedFile ? getServiceName(selectedFile.service) : 'Original'}
            </span>
          </div>

          {originalFiles.length > 1 && (
            <Select
              value={selectedFileIndex.toString()}
              onChange={(e) => setSelectedFileIndex(parseInt(e.target.value))}
              options={fileOptions}
              fullWidth={false}
              className="w-48 text-xs"
            />
          )}
        </div>

        <div className="h-[400px] lg:h-[500px]">
          <Editor
            height="100%"
            language="yaml"
            value={selectedFile?.content || ''}
            theme={editorTheme}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              fontSize: 13,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              padding: { top: 16 },
            }}
          />
        </div>

        {selectedFile && (
          <div className="px-4 py-2 border-t border-[var(--border)] flex items-center justify-between">
            <div className="text-xs text-[var(--text-muted)]">
              {getServiceName(selectedFile.service)} • {selectedFile.name}
            </div>
            {selectedFile.url && (
              <a
                href={selectedFile.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-primary-500 hover:text-primary-600 hover:underline"
              >
                <span>View on GitHub</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}
      </Card>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">{/* Original Config */}
      <Card variant="glass" padding="none" className="overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <FileCode className="w-4 h-4 text-[var(--text-muted)]" />
            <span className="text-sm font-medium text-[var(--text-primary)]">Original</span>
            <span className="px-2 py-0.5 rounded text-xs bg-gray-100 dark:bg-gray-800 text-[var(--text-secondary)]">
              Read Only
            </span>
          </div>

          {originalFiles.length > 1 && (
            <Select
              value={selectedFileIndex.toString()}
              onChange={(e) => setSelectedFileIndex(parseInt(e.target.value))}
              options={fileOptions}
              fullWidth={false}
              className="w-48 text-xs"
            />
          )}
        </div>

        <div className="h-[400px] lg:h-[500px]">
          <Editor
            height="100%"
            language="yaml"
            value={selectedFile?.content || ''}
            theme={editorTheme}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              fontSize: 13,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              padding: { top: 16 },
            }}
          />
        </div>

        {selectedFile && (
          <div className="px-4 py-2 border-t border-[var(--border)] flex items-center justify-between">
            <div className="text-xs text-[var(--text-muted)]">
              {getServiceName(selectedFile.service)} • {selectedFile.name}
            </div>
            {selectedFile.url && (
              <a
                href={selectedFile.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-primary-500 hover:text-primary-600 hover:underline"
              >
                <span>View on GitHub</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}
      </Card>

      {/* Converted Config */}
      <Card variant="glass" padding="none" className="overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <FileCode className="w-4 h-4 text-primary-500" />
            <span className="text-sm font-medium text-[var(--text-primary)]">GitHub Actions</span>
            <span className="px-2 py-0.5 rounded text-xs bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400">
              {readOnly ? 'Preview' : 'Editable'}
            </span>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            leftIcon={copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          >
            {copied ? 'Copied!' : 'Copy'}
          </Button>
        </div>

        <div className="h-[400px] lg:h-[500px]">
          <Editor
            height="100%"
            language="yaml"
            value={convertedYaml}
            onChange={(value) => onYamlChange(value || '')}
            theme={editorTheme}
            options={{
              readOnly,
              minimap: { enabled: false },
              fontSize: 13,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              padding: { top: 16 },
              formatOnPaste: true,
              formatOnType: true,
            }}
          />
        </div>

        <div className="px-4 py-2 border-t border-[var(--border)] text-xs text-[var(--text-muted)]">
          .github/workflows/ci.yml
        </div>
      </Card>
    </div>
  )
}
