import type { VsCodeApi, IconConfig } from '../types'

// Declare the global VS Code API acquisition function
declare function acquireVsCodeApi(): VsCodeApi

// Create singleton instance
let vscodeInstance: VsCodeApi | null = null

/**
 * Get the VS Code API instance (singleton)
 */
export function getVsCodeApi(): VsCodeApi {
  if (!vscodeInstance) {
    vscodeInstance = acquireVsCodeApi()
  }
  return vscodeInstance
}

/**
 * Get icons from window global
 */
export function getIcons(): IconConfig {
  return (window as unknown as { __ICONS__: IconConfig }).__ICONS__
}

/**
 * Post a message to the VS Code extension
 */
export function postMessage(message: unknown): void {
  getVsCodeApi().postMessage(message)
}

// Common message types for type-safe messaging
export type VsCodeMessageType =
  | 'ready'
  | 'saveSettings'
  | 'spawnAgent'
  | 'fetchTasks'
  | 'fetchTasksBySession'
  | 'fetchTodoFiles'
  | 'fetchUnifiedTasks'
  | 'detectTaskSources'
  | 'fetchSessions'
  | 'fetchContextFiles'
  | 'fetchAgentTerminals'
  | 'checkInstalledAgents'
  | 'getDefaultAgent'
  | 'getSecondaryAgent'
  | 'setDefaultAgent'
  | 'setSecondaryAgent'
  | 'getPrewarmStatus'
  | 'togglePrewarm'
  | 'getWorkspaceConfig'
  | 'openContextFile'
  | 'openSession'
  | 'spawnSwarmForTodo'
  | 'installSwarmAgent'
  | 'installCommandPack'
