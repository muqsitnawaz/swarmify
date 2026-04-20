import React from 'react'
import { Icon } from './icons'

export type TabKey = 'mission' | 'workspace' | 'settings'

interface TopBarProps {
  version?: string
  activeTab: TabKey
  onTabChange: (tab: TabKey) => void
  activeSwarmCount: number
  isLightTheme: boolean
  onToggleTheme?: () => void
  onOpenSettings?: () => void
  onOpenSearch?: () => void
}

export function TopBar({
  version,
  activeTab,
  onTabChange,
  activeSwarmCount,
  isLightTheme,
  onToggleTheme,
  onOpenSettings,
  onOpenSearch,
}: TopBarProps) {
  return (
    <header className="sw-topbar">
      <div className="brand">
        <div className="brand-mark">
          <Icon name="zap" size={18} />
        </div>
        <span>swarmify</span>
        {version && (
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--ds-text-dim)', marginLeft: 2 }}>
            v{version}
          </span>
        )}
      </div>
      <div className="divider-v" />
      <div className="sw-tabs">
        <button
          className={`sw-tab ${activeTab === 'mission' ? 'active' : ''}`}
          onClick={() => onTabChange('mission')}
        >
          Mission Control
          {activeSwarmCount > 0 && <span className="sw-tab-badge">{activeSwarmCount}</span>}
        </button>
        <button
          className={`sw-tab ${activeTab === 'workspace' ? 'active' : ''}`}
          onClick={() => onTabChange('workspace')}
        >
          Workspace
        </button>
        <button
          className={`sw-tab ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => onTabChange('settings')}
        >
          Settings
        </button>
      </div>
      <div className="sw-topbar-right">
        <button className="sw-cmd-hint" onClick={onOpenSearch}>
          <Icon name="search" size={12} />
          <span>Search or run command…</span>
          <div className="spacer" />
          <span className="kbd-group">
            <span className="kbd">⌘</span>
            <span className="kbd">K</span>
          </span>
        </button>
        <button className="sw-icon-btn" onClick={onToggleTheme} title="Toggle theme">
          <Icon name={isLightTheme ? 'moon' : 'sun'} size={14} />
        </button>
        <button className="sw-icon-btn" onClick={onOpenSettings} title="Settings">
          <Icon name="cog" size={14} />
        </button>
      </div>
    </header>
  )
}
