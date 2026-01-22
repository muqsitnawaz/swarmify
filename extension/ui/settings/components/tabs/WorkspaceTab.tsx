import React, { useMemo, useState, useEffect } from 'react'
import { ChevronDown, ChevronRight, RefreshCw, ExternalLink, X, FileText } from 'lucide-react'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { SectionHeader } from '../common'
import { OauthDialog } from '../common/OAuthDialog'
import { renderTodoDescription } from '../../utils'
import { getAgentIcon } from '../../utils'
import { SOURCE_BADGES } from '../../constants'
import {
  AgentSettings,
  ContextFile,
  IconConfig,
  TaskSource,
  TodoFile,
  TodoItem,
  UnifiedTask,
  WorkspaceConfig,
} from '../../types'

interface WorkspaceTabProps {
  todoFiles: TodoFile[]
  unifiedTasks: UnifiedTask[]
  todoLoading: boolean
  unifiedTasksLoading: boolean
  expandedSources: Set<TaskSource>
  availableSources: { markdown?: boolean; linear: boolean; github: boolean }
  settings: AgentSettings | null
  defaultAgent: string
  contextFiles: ContextFile[]
  contextLoading: boolean
  collapsedDirs: Set<string>
  workspaceConfig: WorkspaceConfig | null
  workspaceConfigLoaded: boolean
  workspaceConfigExists: boolean
  workspacePath: string | null
  githubRepo: string | null
  dismissedTaskIds: Set<string>
  icons: IconConfig
  isLightTheme: boolean
  showLinearAuth: boolean
  showGitHubAuth: boolean
  onToggleSource: (source: TaskSource) => void
  onSpawnTodo: (item: TodoItem, filePath: string) => void
  onRefreshTasks: () => void
  onRefreshContext: () => void
  onUpdateTaskSources: (sources: Partial<AgentSettings['taskSources']>) => void
  onToggleDir: (path: string) => void
  onOpenFile: (path: string) => void
  onInitWorkspaceConfig: () => void
  onSaveWorkspaceConfig: (config: WorkspaceConfig) => void
  onDismissTask: (taskId: string) => void
  onConnectLinear: () => void
  onConnectGitHub: () => void
  onLinearAuthComplete: () => void
  onLinearAuthCancel: () => void
  onGitHubAuthComplete: () => void
  onGitHubAuthCancel: () => void
}

interface WorkspaceTask {
  id: string
  source: TaskSource
  title: string
  description?: string
  completed?: boolean
  todoItem?: TodoItem
  filePath?: string
  planFile?: string
  metadata?: UnifiedTask['metadata']
}

const SOURCE_ORDER: Record<TaskSource, number> = {
  markdown: 0,
  linear: 1,
  github: 2,
}

export function WorkspaceTab(props: WorkspaceTabProps) {
  const {
    todoFiles,
    unifiedTasks,
    todoLoading,
    unifiedTasksLoading,
    availableSources,
    showLinearAuth,
    showGitHubAuth,
    settings,
    defaultAgent,
    contextFiles,
    contextLoading,
    collapsedDirs,
    workspaceConfig,
    workspaceConfigLoaded,
    workspaceConfigExists,
    workspacePath,
    githubRepo,
    dismissedTaskIds,
    icons,
    isLightTheme,
    onSpawnTodo,
    onRefreshTasks,
    onRefreshContext,
    onUpdateTaskSources,
    onToggleDir,
    onOpenFile,
    onInitWorkspaceConfig,
    onSaveWorkspaceConfig,
    onDismissTask,
    onConnectLinear,
    onConnectGitHub,
    onLinearAuthComplete,
    onLinearAuthCancel,
    onGitHubAuthComplete,
    onGitHubAuthCancel,
  } = props

  const flatTasks = useMemo<WorkspaceTask[]>(() => {
    const items: WorkspaceTask[] = []

    if (settings?.taskSources?.markdown ?? true) {
      todoFiles.forEach(file => {
        file.items.forEach((item, index) => {
          const id = `md:${file.path}:${item.line}:${index}`
          if (dismissedTaskIds.has(id)) return
          items.push({
            id,
            source: 'markdown',
            title: item.title || 'Untitled',
            description: item.description,
            completed: item.completed,
            todoItem: item,
            filePath: file.path,
            planFile: item.planFile,
          })
        })
      })
    }

    const filteredUnified = unifiedTasks.filter(task => {
      if (dismissedTaskIds.has(task.id)) return false
      if (task.source === 'linear') return settings?.taskSources?.linear
      if (task.source === 'github') return settings?.taskSources?.github
      return true
    })

    filteredUnified
      .sort((a, b) => SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source])
      .forEach(task => {
        items.push({
          id: task.id,
          source: task.source,
          title: task.title,
          description: task.description,
          metadata: task.metadata,
        })
      })

    return items
  }, [todoFiles, unifiedTasks, settings?.taskSources, dismissedTaskIds])

  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set())
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    const validIds = new Set(flatTasks.map(task => task.id))
    setSelectedTaskIds(prev => {
      const next = new Set<string>()
      prev.forEach(id => {
        if (validIds.has(id)) next.add(id)
      })
      return next
    })
  }, [flatTasks])

  const selectedCount = selectedTaskIds.size

  const toggleTaskSelection = (id: string, checked: boolean) => {
    setSelectedTaskIds(prev => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const toggleTaskExpansion = (id: string) => {
    setExpandedTaskIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleRunTask = (task: WorkspaceTask) => {
    if (task.source === 'markdown' && task.todoItem && task.filePath && !task.completed) {
      onSpawnTodo(task.todoItem, task.filePath)
    }
  }

  // Get default agent icon
  const getDefaultAgentIcon = () => {
    const agentKey = defaultAgent?.toLowerCase() || 'claude'
    const iconKey = agentKey as keyof IconConfig
    return icons[iconKey] ? getAgentIcon(agentKey, icons, isLightTheme) : getAgentIcon('claude', icons, isLightTheme)
  }

  // Build symlink map and separate source files
  const symlinksByTarget: Record<string, ContextFile[]> = {}
  const sourceFiles: ContextFile[] = []

  contextFiles.forEach(file => {
    if (file.isSymlink && file.symlinkTarget && file.symlinkTarget !== '(broken)') {
      if (!symlinksByTarget[file.symlinkTarget]) symlinksByTarget[file.symlinkTarget] = []
      symlinksByTarget[file.symlinkTarget].push(file)
    } else {
      sourceFiles.push(file)
    }
  })

  interface TreeNode {
    name: string
    fullPath: string
    files: ContextFile[]
    children: Map<string, TreeNode>
  }

  const root: TreeNode = { name: '', fullPath: '', files: [], children: new Map() }

  sourceFiles.forEach(file => {
    const parts = file.path.split('/')
    const fileName = parts.pop()!
    let current = root
    let pathSoFar = ''

    for (const part of parts) {
      pathSoFar = pathSoFar ? `${pathSoFar}/${part}` : part
      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          fullPath: pathSoFar,
          files: [],
          children: new Map()
        })
      }
      current = current.children.get(part)!
    }
    current.files.push({ ...file, path: `${pathSoFar ? `${pathSoFar}/` : ''}${fileName}` })
  })

  const collapseNode = (node: TreeNode): TreeNode => {
    const collapsedChildren = new Map<string, TreeNode>()
    node.children.forEach((child, key) => {
      collapsedChildren.set(key, collapseNode(child))
    })
    node.children = collapsedChildren

    if (node.children.size === 1 && node.files.length === 0) {
      const [, child] = [...node.children.entries()][0]
      return {
        name: node.name ? `${node.name}/${child.name}` : child.name,
        fullPath: child.fullPath,
        files: child.files,
        children: child.children
      }
    }

    return node
  }

  const collapsedRoot = collapseNode(root)

  const renderNode = (node: TreeNode, depth: number, isRootLevel: boolean): React.ReactNode[] => {
    const result: React.ReactNode[] = []
    const indent = depth * 16

    if (node.name && !isRootLevel) {
      const isExpanded = !collapsedDirs.has(node.fullPath)
      result.push(
        <button
          key={`dir-${node.fullPath}`}
          onClick={() => onToggleDir(node.fullPath)}
          className="flex items-center gap-2 w-full px-2 py-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--background)] rounded-lg"
          style={{ paddingLeft: `${8 + indent}px` }}
        >
          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          <span className="font-mono text-xs">{node.name}/</span>
        </button>
      )
      if (!isExpanded) return result
    }

    node.files.forEach(file => {
      const symlinks = symlinksByTarget[file.path] || []
      result.push(
        <div
          key={file.path}
          className="flex items-center gap-2 w-full px-2 py-2 text-sm hover:bg-[var(--background)] rounded-lg overflow-hidden"
          style={{ paddingLeft: `${8 + indent + (node.name && !isRootLevel ? 24 : 0)}px` }}
        >
          <button
            onClick={() => onOpenFile(file.path)}
            className="flex items-center gap-2 min-w-0"
          >
            <img
              src={getAgentIcon(file.agent, icons, isLightTheme)}
              alt={file.agent}
              className="w-4 h-4 flex-shrink-0"
            />
            <span className="font-medium flex-shrink-0">
              {file.path.split('/').pop()}
            </span>
          </button>
          {symlinks.length > 0 && (
            <span className="flex items-center gap-1 flex-shrink-0 text-[10px] text-[var(--muted-foreground)]">
              Symlinks
              {symlinks.map(sym => (
                <button
                  key={sym.path}
                  onClick={(event) => {
                    event.stopPropagation()
                    onOpenFile(sym.path)
                  }}
                  className="hover:opacity-80"
                  title={`Open ${sym.path.split('/').pop()}`}
                >
                  <img
                    src={getAgentIcon(sym.agent, icons, isLightTheme)}
                    alt={sym.agent}
                    className="w-3.5 h-3.5"
                  />
                </button>
              ))}
            </span>
          )}
          <span className="text-xs text-[var(--muted-foreground)] truncate flex-1 text-left min-w-0">
            {file.preview}
          </span>
          <span className="text-xs text-[var(--muted-foreground)] whitespace-nowrap flex-shrink-0 ml-auto">
            {file.lines}L
          </span>
        </div>
      )
    })

    const sortedChildren = [...node.children.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    sortedChildren.forEach(([, child]) => {
      result.push(...renderNode(child, depth + (node.name && !isRootLevel ? 1 : 0), false))
    })

    return result
  }

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <SectionHeader className="mb-0">Tasks</SectionHeader>
            {workspacePath && (
              <div className="text-xs text-[var(--muted-foreground)] mt-1 font-mono">
                {workspacePath}
              </div>
            )}
            {githubRepo && (
              <a
                href={`https://github.com/${githubRepo}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] mt-1 hover:text-[var(--foreground)] transition-colors"
                onClick={(e) => {
                  e.preventDefault()
                  window.open(`https://github.com/${githubRepo}`, '_blank')
                }}
              >
                <img src={icons.github} alt="GitHub" className="w-3.5 h-3.5" />
                <span>{githubRepo}</span>
              </a>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefreshTasks}
            disabled={todoLoading || unifiedTasksLoading}
          >
            Refresh
          </Button>
        </div>

        {(!availableSources.linear || !availableSources.github) && (
          <div className="flex gap-2 mb-4 px-3">
            {!availableSources.linear && (
              <Button
                variant="outline"
                size="sm"
                onClick={onConnectLinear}
              >
                Connect Linear
              </Button>
            )}
            {!availableSources.github && (
              <Button
                variant="outline"
                size="sm"
                onClick={onConnectGitHub}
              >
                Connect GitHub
              </Button>
            )}
          </div>
        )}

        {(todoLoading || unifiedTasksLoading) && flatTasks.length === 0 ? (
          <div className="text-center py-8 text-[var(--muted-foreground)]">Loading tasks...</div>
        ) : flatTasks.length === 0 ? (
          <div className="text-center py-8 text-[var(--muted-foreground)]">
            No tasks found. Add a TODO.md file or connect Linear or GitHub.
          </div>
        ) : (
          <div className="space-y-2">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--background)]">
              {flatTasks.map(task => {
                const badge = SOURCE_BADGES[task.source]
                const isSelected = selectedTaskIds.has(task.id)
                const isExpanded = expandedTaskIds.has(task.id)
                const taskMeta = task.source === 'markdown'
                  ? task.filePath
                    ? `${task.filePath}${task.todoItem?.line ? `:${task.todoItem.line}` : ''}`
                    : undefined
                  : task.metadata?.identifier
                const canRun = task.source === 'markdown' && task.todoItem && task.filePath && !task.completed
                const hasDescription = task.description && task.source === 'markdown'

                return (
                  <div
                    key={task.id}
                    className="border-b border-[var(--border)] last:border-b-0"
                  >
                    <div className="flex items-start gap-3 px-3 py-2">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(checked) => toggleTaskSelection(task.id, Boolean(checked))}
                      />
                      <span
                        className="mt-0.5 text-[10px] font-bold px-2 py-0.5 rounded flex-shrink-0"
                        style={{ backgroundColor: badge.color, color: '#fff' }}
                      >
                        {badge.label}
                      </span>
                      <button
                        className="flex-1 min-w-0 text-left"
                        onClick={() => hasDescription && toggleTaskExpansion(task.id)}
                      >
                        <div
                          className={`text-sm ${task.completed ? 'line-through text-[var(--muted-foreground)]' : ''}`}
                        >
                          {task.title}
                        </div>
                        {!isExpanded && hasDescription && (
                          <div className="text-xs text-[var(--muted-foreground)] mt-1 line-clamp-2">
                            {renderTodoDescription(task.description!, true)}
                          </div>
                        )}
                      </button>
                      <div className="flex items-center gap-1 ml-auto flex-shrink-0">
                        {canRun && (
                          <button
                            onClick={() => handleRunTask(task)}
                            className="flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--background)] border border-[var(--border)] hover:border-[var(--primary)] hover:bg-[var(--primary)]/10 transition-colors"
                            title={`Run with ${defaultAgent || 'default agent'}`}
                          >
                            <img
                              src={getDefaultAgentIcon()}
                              alt={defaultAgent || 'agent'}
                              className="w-4 h-4"
                            />
                          </button>
                        )}
                        {task.planFile && (
                          <button
                            onClick={() => onOpenFile(task.planFile!)}
                            className="flex items-center justify-center w-8 h-8 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:bg-[var(--muted)] transition-colors"
                            title={`Open plan: ${task.planFile}`}
                          >
                            <FileText className="w-4 h-4" />
                          </button>
                        )}
                        {task.metadata?.url && (
                          <a
                            href={task.metadata.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center justify-center w-8 h-8 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:bg-[var(--muted)] transition-colors"
                            title="Open in browser"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        )}
                        <button
                          onClick={() => onDismissTask(task.id)}
                          className="flex items-center justify-center w-8 h-8 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                          title="Dismiss task"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    {isExpanded && hasDescription && (
                      <div className="border-t border-[var(--border)] mt-1">
                        <div className="px-3 pb-3 pt-2 ml-[52px]">
                          <div className="text-xs text-[var(--muted-foreground)]">
                            {renderTodoDescription(task.description!, false)}
                          </div>
                          {taskMeta && (
                            <div className="text-[10px] text-[var(--muted-foreground)] mt-2 font-mono">
                              {taskMeta}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {selectedCount > 1 && (
              <div className="sticky bottom-0 flex items-center justify-between px-4 py-3 rounded-xl border border-[var(--border)] bg-[var(--muted)]">
                <span className="text-sm text-[var(--muted-foreground)]">
                  {selectedCount} tasks selected
                </span>
                <div className="flex items-center gap-2">
                  <Button size="sm">Run with Swarm</Button>
                  <Button size="sm" variant="secondary">Run with Ralph</Button>
                </div>
              </div>
            )}
          </div>
        )}

      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
          <SectionHeader className="mb-0">Context Files</SectionHeader>
          <Button size="sm" variant="ghost" onClick={onRefreshContext} disabled={contextLoading}>
            <RefreshCw className={`w-4 h-4 ${contextLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
        <div className="rounded-xl bg-[var(--muted)]">
          {contextLoading && contextFiles.length === 0 ? (
            <div className="p-4 text-sm text-[var(--muted-foreground)]">
              Scanning workspace...
            </div>
          ) : contextFiles.length === 0 ? (
            <div className="p-4 text-sm text-[var(--muted-foreground)]">
              No context files found. Create AGENTS.md or agent-specific files to add context.
            </div>
          ) : (
            <div className="p-2">
              {renderNode(collapsedRoot, 0, true)}
            </div>
          )}
        </div>
      </section>

      <section>
        <SectionHeader>.agents Config</SectionHeader>
        <div className="rounded-xl bg-[var(--muted)]">
          {workspaceConfigLoaded && !workspaceConfigExists ? (
            <div className="p-4">
              <p className="text-sm text-[var(--muted-foreground)] mb-3">
                No workspace .agents config found. Initialize to configure context file symlinks.
              </p>
              <Button size="sm" onClick={onInitWorkspaceConfig}>
                Initialize Config
              </Button>
            </div>
          ) : workspaceConfig ? (
            <div className="p-4 space-y-4">
              <div className="space-y-3">
                <div className="text-xs text-[var(--muted-foreground)] uppercase tracking-wider">
                  Context Mappings
                </div>
                {workspaceConfig.context.map((mapping, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-sm">
                    <span className="font-mono text-xs bg-[var(--background)] px-2 py-1 rounded">
                      {mapping.source}
                    </span>
                    <span className="text-[var(--muted-foreground)]">-&gt;</span>
                    <span className="text-xs text-[var(--muted-foreground)]">
                      {mapping.aliases.join(', ') || 'no aliases'}
                    </span>
                    <button
                      className="ml-auto text-[var(--muted-foreground)] hover:text-[var(--foreground)] text-xs"
                      onClick={() => {
                        const newContext = workspaceConfig.context.filter((_, i) => i !== idx)
                        onSaveWorkspaceConfig({ ...workspaceConfig, context: newContext })
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  className="text-xs text-[var(--primary)] hover:underline"
                  onClick={() => {
                    const source = prompt('Source file:', 'AGENTS.md')
                    if (!source) return
                    const aliasesStr = prompt('Aliases (comma-separated):', 'CLAUDE.md, GEMINI.md')
                    if (aliasesStr === null) return
                    const aliases = aliasesStr.split(',').map(s => s.trim()).filter(Boolean)
                    const newContext = [...workspaceConfig.context, { source, aliases }]
                    onSaveWorkspaceConfig({ ...workspaceConfig, context: newContext })
                  }}
                >
                  + Add mapping
                </button>
              </div>
            </div>
          ) : (
            <div className="p-4 text-sm text-[var(--muted-foreground)]">
              Loading workspace config...
            </div>
          )}
        </div>
      </section>

      {showLinearAuth && (
        <OauthDialog
          provider="linear"
          onAuthComplete={onLinearAuthComplete}
          onClose={onLinearAuthCancel}
        />
      )}

      {showGitHubAuth && (
        <OauthDialog
          provider="github"
          onAuthComplete={onGitHubAuthComplete}
          onClose={onGitHubAuthCancel}
        />
      )}
    </div>
  )
}
