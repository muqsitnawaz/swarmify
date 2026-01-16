import React from 'react'
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'
import { Button } from '../ui/button'
import { SectionHeader } from '../common'
import { getAgentIcon } from '../../utils'
import { ContextFile, IconConfig } from '../../types'

interface ContextTabProps {
  contextFiles: ContextFile[]
  loading: boolean
  collapsedDirs: Set<string>
  icons: IconConfig
  isLightTheme: boolean
  onRefresh: () => void
  onToggleDir: (path: string) => void
  onOpenFile: (path: string) => void
}

export function ContextTab({
  contextFiles,
  loading,
  collapsedDirs,
  icons,
  isLightTheme,
  onRefresh,
  onToggleDir,
  onOpenFile,
}: ContextTabProps) {
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

  // Build nested tree structure
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
    current.files.push(file)
  })

  // Collapse single-child chains
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

  // Render tree recursively
  const renderNode = (node: TreeNode, depth: number, isRootLevel: boolean): React.ReactNode[] => {
    const result: React.ReactNode[] = []
    const indent = depth * 16

    // Render directory header if not root
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

    // Render files
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
                  onClick={(e) => {
                    e.stopPropagation()
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

    // Render children
    const sortedChildren = [...node.children.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    sortedChildren.forEach(([, child]) => {
      result.push(...renderNode(child, depth + (node.name && !isRootLevel ? 1 : 0), false))
    })

    return result
  }

  return (
    <div className="space-y-8">
      <section>
        <div className="flex items-center justify-between mb-4">
          <SectionHeader className="mb-0">Memory Files</SectionHeader>
          <Button size="sm" variant="ghost" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
        <div className="rounded-xl bg-[var(--muted)]">
          {loading && contextFiles.length === 0 ? (
            <div className="p-4 text-sm text-[var(--muted-foreground)]">
              Scanning workspace...
            </div>
          ) : contextFiles.length === 0 ? (
            <div className="p-4 text-sm text-[var(--muted-foreground)]">
              No context files found. Create CLAUDE.md, GEMINI.md, or AGENTS.md files to add context for agents.
            </div>
          ) : (
            <div className="p-2">
              {renderNode(collapsedRoot, 0, true)}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
