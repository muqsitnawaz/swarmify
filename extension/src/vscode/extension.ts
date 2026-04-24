import * as vscode from 'vscode';
import { BUILT_IN_AGENTS, getBuiltInByKey, getBuiltInDefByTitle, getBuiltInByPrefix } from '../core/agents';
import {
  AgentConfig,
  buildIconPath,
  createAgentConfig,
  getBuiltInByTitle
} from './agents.vscode';
import * as claudemd from './claudemd.vscode';
import { AgentsMarkdownEditorProvider, swarmCurrentDocument } from './customEditor';
import * as git from './git.vscode';
import { AgentSettings, hasLoginEnabled, PromptEntry } from '../core/settings';
import * as settings from './settings.vscode';
import * as swarm from './swarm.vscode';
import { startWatchdog } from './watchdog.vscode';
import * as notifications from './notifications.vscode';
import * as terminals from './terminals.vscode';
import * as sessionTracker from './sessionTracker';
import { buildAgentTerminalEnv } from '../core/terminals';
import {
  AgentsViewJsonAgent,
  AgentsViewJsonVersion,
  pickBestVersion,
  sessionUsedPercent,
  buildLaunchCommand,
  buildResumeInput,
  isVersionStillUsable,
} from '../core/resumeInBest';
import * as os from 'os';
import * as fsSync from 'fs';
import { randomUUID } from 'crypto';
import * as workbench from './workbench.vscode';
import { ensureSymlinksOnWorkspaceOpen, createSymlinksCodebaseWide } from './agentlinks.vscode';
import {
  initWorkspaceConfig,
  getActiveWorkspaceFolder,
  loadWorkspaceConfig,
  watchConfigFile,
  watchUserConfig,
} from './swarmifyConfig.vscode';
import {
  CLAUDE_TITLE,
  CODEX_TITLE,
  GEMINI_TITLE,
  CURSOR_TITLE,
  OPENCODE_TITLE,
  findTerminalNameByTabLabel,
  getExpandedAgentName,
  getTerminalDisplayInfo,
  parseTerminalName,
  sanitizeLabel,
  formatTerminalTitle,
  getSessionChunk,
  truncateText,
  extractFirstNWords,
  extractLinearTicketId,
  formatRelativeTime,
  TerminalIdentificationOptions,
  prefixToAgentType,
  SessionAgentType
} from '../core/utils';
import * as path from 'path';
import {
  createTmuxTerminal,
  getTmuxState,
  isTmuxTerminal,
  registerTmuxCleanup,
  tmuxSplitH,
  tmuxSplitV,
  isTmuxAvailable
} from './tmux';
import { DEFAULT_DISPLAY_PREFERENCES } from '../core/settings';
import * as prewarm from './prewarm.vscode';
import * as readiness from './terminalReadiness';
import { resolveAlias, isAgentInstalled } from '../core/agentModels';
import { supportsPrewarming, buildResumeCommand, PREWARM_CONFIGS, PrewarmAgentType } from '../core/prewarm';
import { needsPrewarming, generateClaudeSessionId, buildClaudeOpenCommand, listOpencodeSessions } from '../core/prewarm.simple';
import { getSessionPathBySessionId, getSessionPreviewInfo, getOpenCodeSessionPreviewInfo, getCursorSessionPreviewInfo } from './sessions.vscode';
import * as tasksImport from './tasks.vscode';
import { SOURCE_BADGES } from '../core/tasks';
import * as handoff from '../core/handoff';

// Settings types are now imported from ./settings
// Settings functions are in ./settings.vscode

let agentStatusBarItem: vscode.StatusBarItem | undefined;
let defaultAgentTitle: string = CLAUDE_TITLE;
let secondaryAgentTitle: string = CODEX_TITLE;
let lastFocusedTerminal: vscode.Terminal | null = null;

// BUILT_IN_AGENTS is now imported from ./agents

// Prompts helpers (file-based storage at ~/.swarmify/agents/prompts.yaml)
function getPrompts(): PromptEntry[] {
  return settings.readPrompts();
}

function savePrompts(prompts: PromptEntry[]): void {
  settings.writePrompts(prompts);
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function getDisplayPrefs(context: vscode.ExtensionContext) {
  return settings.getSettings(context).display || DEFAULT_DISPLAY_PREFERENCES;
}

function buildTerminalTitle(
  prefix: string,
  label: string | undefined | null,
  context: vscode.ExtensionContext,
  sessionId?: string | null,
  isFocused?: boolean
): string {
  const display = getDisplayPrefs(context);
  const sessionChunk = display.showSessionIdInTitles ? getSessionChunk(sessionId || undefined) : null;
  return formatTerminalTitle(prefix, { label: label || undefined, display, sessionChunk, isFocused });
}

// Terminal readiness detection moved to src/vscode/terminalReadiness.ts.
// All spawn/resume flows now call readiness.waitFor(t, 'promptReady') instead.

/**
 * Detect OpenCode session ID after spawn by comparing session lists.
 * OpenCode creates its own session IDs (ses_xxx format) internally.
 * This runs asynchronously and updates the terminal entry when found.
 */
async function detectOpencodeSessionId(
  terminal: vscode.Terminal,
  terminalId: string,
  cwd: string,
  sessionsBefore: string[],
  context: vscode.ExtensionContext
): Promise<void> {
  // Wait for OpenCode to start and create a session
  await new Promise(resolve => setTimeout(resolve, 3000));

  const sessionsAfter = await listOpencodeSessions(cwd);
  if (!sessionsAfter || sessionsAfter.length === 0) {
    console.log(`[PREWARM] OpenCode: No sessions found after spawn`);
    return;
  }

  // Find new session (in sessionsAfter but not in sessionsBefore)
  const beforeSet = new Set(sessionsBefore);
  const newSessions = sessionsAfter.filter(id => !beforeSet.has(id));

  let sessionId: string | null = null;
  if (newSessions.length === 1) {
    sessionId = newSessions[0];
  } else if (newSessions.length > 1) {
    // Multiple new sessions - take the first one (most recent based on list order)
    sessionId = newSessions[0];
  } else {
    // No new sessions - take the most recent from after list
    sessionId = sessionsAfter[0];
  }

  if (sessionId) {
    console.log(`[PREWARM] OpenCode detected session ID: ${sessionId}`);
    terminals.setSessionId(terminal, sessionId);
    terminals.setAgentType(terminal, 'opencode');
    await prewarm.recordTerminalSession(context, terminalId, sessionId, 'opencode', cwd);

    // Update terminal title to include session ID
    updateStatusBarForTerminal(terminal, context.extensionPath);
    startAutoLabelPollerForTerminal(terminal, context);
  }
}

async function updateTerminalTitleOnFocus(
  newTerminal: vscode.Terminal | undefined,
  context: vscode.ExtensionContext
): Promise<void> {
  const display = getDisplayPrefs(context);

  // Only update titles if showLabelOnlyOnFocus is enabled
  if (!display.showLabelOnlyOnFocus) {
    return;
  }

  // Update the newly focused terminal's title (with label)
  if (newTerminal) {
    const entry = terminals.getByTerminal(newTerminal);
    if (entry?.agentConfig) {
      const newTitle = buildTerminalTitle(
        entry.agentConfig.prefix,
        entry.label,
        context,
        entry.sessionId,
        true  // isFocused = true
      );
      await terminals.renameTerminal(newTerminal, newTitle);
    }
  }

  // Update the previously focused terminal's title (without label)
  if (lastFocusedTerminal && lastFocusedTerminal !== newTerminal) {
    const prevEntry = terminals.getByTerminal(lastFocusedTerminal);
    if (prevEntry?.agentConfig) {
      const prevTitle = buildTerminalTitle(
        prevEntry.agentConfig.prefix,
        prevEntry.label,
        context,
        prevEntry.sessionId,
        false  // isFocused = false
      );
      await terminals.renameTerminal(lastFocusedTerminal, prevTitle);
    }
  }

  // Update tracking
  lastFocusedTerminal = newTerminal || null;
}

interface PromptQuickPickItem extends vscode.QuickPickItem {
  entry?: PromptEntry;
  isAddNew?: boolean;
}

async function showPrompts(): Promise<void> {
  const terminal = vscode.window.activeTerminal;
  if (!terminal) {
    vscode.window.showInformationMessage('No active terminal');
    return;
  }

  const parsed = parseTerminalName(terminal.name);
  if (!parsed.isAgent) {
    vscode.window.showInformationMessage('Active terminal is not an agent terminal');
    return;
  }

  const prompts = getPrompts();

  // Sort: favorites first, then by accessedAt descending (most recently used first)
  const sorted = [...prompts].sort((a, b) => {
    if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
    return b.accessedAt - a.accessedAt;
  });

  const quickPick = vscode.window.createQuickPick<PromptQuickPickItem>();
  quickPick.placeholder = 'Search prompts...';
  quickPick.matchOnDescription = true;

  const buildItems = (): PromptQuickPickItem[] => {
    const items: PromptQuickPickItem[] = sorted.map(entry => ({
      label: `${entry.isFavorite ? '$(star-full) ' : ''}${entry.title}`,
      description: truncateText(entry.content, 50),
      detail: entry.content,
      entry,
      buttons: [
        {
          iconPath: new vscode.ThemeIcon(entry.isFavorite ? 'star-full' : 'star-empty'),
          tooltip: entry.isFavorite ? 'Remove from favorites' : 'Add to favorites'
        },
        {
          iconPath: new vscode.ThemeIcon('trash'),
          tooltip: 'Delete prompt'
        }
      ]
    }));

    items.push({
      label: '$(add) Add new prompt',
      isAddNew: true
    });

    return items;
  };

  quickPick.items = buildItems();

  quickPick.onDidTriggerItemButton(async (e) => {
    const item = e.item;
    if (!item.entry) return;

    const buttonIndex = (quickPick.items.find(i => i.entry?.id === item.entry?.id) as PromptQuickPickItem)
      ?.buttons?.indexOf(e.button);

    if (buttonIndex === 0) {
      // Toggle favorite
      item.entry.isFavorite = !item.entry.isFavorite;
      item.entry.updatedAt = Date.now();
      savePrompts(prompts);
      // Re-sort and rebuild items
      sorted.sort((a, b) => {
        if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
        return b.accessedAt - a.accessedAt;
      });
      quickPick.items = buildItems();
    } else if (buttonIndex === 1) {
      // Delete
      const idx = prompts.findIndex(p => p.id === item.entry?.id);
      if (idx !== -1) {
        prompts.splice(idx, 1);
        const sortedIdx = sorted.findIndex(p => p.id === item.entry?.id);
        if (sortedIdx !== -1) sorted.splice(sortedIdx, 1);
        savePrompts(prompts);
        quickPick.items = buildItems();
      }
    }
  });

  quickPick.onDidAccept(async () => {
    const selected = quickPick.selectedItems[0];
    if (!selected) return;

    quickPick.hide();

    if (selected.isAddNew) {
      // Add new prompt flow
      const title = await vscode.window.showInputBox({
        prompt: 'Prompt title',
        placeHolder: 'e.g., Debug Helper'
      });
      if (!title) return;

      const content = await vscode.window.showInputBox({
        prompt: 'Prompt content',
        placeHolder: 'Enter the prompt text...'
      });
      if (!content) return;

      const now = Date.now();
      const newEntry: PromptEntry = {
        id: generateId(),
        title,
        content,
        isFavorite: false,
        createdAt: now,
        updatedAt: now,
        accessedAt: now
      };

      prompts.push(newEntry);
      savePrompts(prompts);
      vscode.window.showInformationMessage(`Added "${title}" to Prompts`);
    } else if (selected.entry) {
      // Update accessedAt and paste to terminal (no auto-execute)
      selected.entry.accessedAt = Date.now();
      savePrompts(prompts);
      terminal.sendText(selected.entry.content, false);
      terminal.show();
    }
  });

  quickPick.onDidHide(() => quickPick.dispose());
  quickPick.show();
}

function getAgentsToOpen(context: vscode.ExtensionContext): AgentConfig[] {
  const agentSettings = settings.getSettings(context);
  const extensionPath = context.extensionPath;
  const agents: AgentConfig[] = [];

  // Built-in agents
  for (const def of BUILT_IN_AGENTS) {
    const config = agentSettings.builtIn[def.key as keyof AgentSettings['builtIn']];
    if (config.login && config.instances > 0) {
      agents.push({ ...createAgentConfig(extensionPath, def.title, def.command, def.icon, def.prefix), count: config.instances });
    }
  }

  // Custom agents
  for (const custom of agentSettings.custom) {
    if (custom.login && custom.instances > 0) {
      agents.push({
        ...createAgentConfig(extensionPath, custom.name, custom.command, 'agents.png', custom.name.toLowerCase()),
        count: custom.instances
      });
    }
  }

  return agents;
}

// getBuiltInByTitle is now imported from ./agents.vscode

interface AgentTerminalInfo {
  isAgent: boolean;
  prefix: string | null;
  label: string | null;
  iconPath: vscode.IconPath | null;
}

/**
 * Extract identification options from a VS Code terminal.
 */
function extractTerminalIdentificationOptions(terminal: vscode.Terminal): TerminalIdentificationOptions {
  const opts = terminal.creationOptions as vscode.TerminalOptions;
  const env = opts?.env;
  const terminalId = env ? env['AGENT_TERMINAL_ID'] : undefined;

  // Extract icon filename from iconPath
  let iconFilename: string | null = null;
  if (opts?.iconPath) {
    const icon: any = opts.iconPath;
    if (icon instanceof vscode.Uri) {
      iconFilename = path.basename(icon.fsPath);
    } else if (icon && typeof icon === 'object') {
      // Handle { light: Uri; dark: Uri } shape
      const candidate = icon.light ?? icon.dark ?? icon;
      if (candidate instanceof vscode.Uri || (candidate && typeof candidate.fsPath === 'string')) {
        iconFilename = path.basename(candidate.fsPath);
      }
    }
  }

  return {
    name: terminal.name,
    terminalId: terminalId as string | undefined,
    iconFilename
  };
}

function identifyAgentTerminal(terminal: vscode.Terminal, extensionPath: string): AgentTerminalInfo {
  // First check terminals module state
  const entry = terminals.getByTerminal(terminal);
  if (entry && entry.agentConfig) {
    return {
      isAgent: true,
      prefix: entry.agentConfig.title,
      label: entry.label ?? null,
      iconPath: buildIconPath(entry.agentConfig.title, extensionPath)
    };
  }

  // Fall back to central identification function with all available inputs
  const identOpts = extractTerminalIdentificationOptions(terminal);
  const info = getTerminalDisplayInfo(identOpts);
  if (info.isAgent && info.prefix) {
    return {
      isAgent: true,
      prefix: info.prefix,
      label: info.label,
      iconPath: buildIconPath(info.prefix, extensionPath)
    };
  }

  return { isAgent: false, prefix: null, label: null, iconPath: null };
}

function getAgentConfigFromTerminal(
  terminal: vscode.Terminal,
  context: vscode.ExtensionContext
): Omit<AgentConfig, 'count'> | null {
  const info = identifyAgentTerminal(terminal, context.extensionPath);

  if (!info.isAgent || !info.prefix) {
    // Check custom agents by name
    const terminalName = terminal.name.trim();
    const agentSettings = settings.getSettings(context);
    for (const custom of agentSettings.custom) {
      if (terminalName === custom.name || terminalName.startsWith(`${custom.name} - `)) {
        return createAgentConfig(context.extensionPath, custom.name, custom.command, 'agents.png', custom.name.toLowerCase());
      }
    }
    return null;
  }

  // Check built-in agents
  const builtIn = getBuiltInDefByTitle(info.prefix);
  if (builtIn) {
    return createAgentConfig(context.extensionPath, builtIn.title, builtIn.command, builtIn.icon, builtIn.prefix);
  }

  // Check custom agents
  const agentSettings = settings.getSettings(context);
  for (const custom of agentSettings.custom) {
    if (info.prefix === custom.name) {
      return createAgentConfig(context.extensionPath, custom.name, custom.command, 'agents.png', custom.name.toLowerCase());
    }
  }

  return null;
}

// Settings functions are now in ./settings.vscode

// scanExistingEditorTerminals is now terminals.scanExisting()

// Infer agent config from terminal name for scan
function inferAgentConfigFromName(name: string, extensionPath: string, knownPrefix?: string | null): Omit<AgentConfig, 'count'> | null {
  // Build identification options - when called from scanExisting, we may have a knownPrefix
  const identOpts: TerminalIdentificationOptions = { name };
  // If we have a knownPrefix from the env var extraction, we can reconstruct a terminalId pattern
  // to trigger the terminalId fallback strategy
  if (knownPrefix) {
    identOpts.terminalId = `${knownPrefix}-0`; // Fake ID just to trigger the strategy
  }

  const info = getTerminalDisplayInfo(identOpts);
  if (!info.isAgent || !info.prefix) return null;

  const def = getBuiltInDefByTitle(info.prefix);
  if (def) {
    return createAgentConfig(extensionPath, def.title, def.command, def.icon, def.prefix);
  }
  return null;
}

export async function activate(context: vscode.ExtensionContext) {
  console.log('Cursor Agents extension is now active');

  // Store context for deactivate
  extensionContext = context;

  // Initialize terminal readiness event tracking (shell integration + close cleanup)
  readiness.initReadiness(context);

  sessionTracker.initSessionTracker(context);
  sessionTracker.onSessionChanged((terminal, _oldId, newId) => {
    terminals.setSessionId(terminal, newId);
    updateStatusBarForTerminal(terminal, context.extensionPath);
  });

  // Cross-window live-terminal registry: every VS Code window publishes its
  // agent terminals to a shared JSON file so the Foreman (and future tools)
  // can see the factory state across all windows. Keepalive every 15s; also
  // fires on open/close.
  initForemanRegistry(context);

  // Initialize session pre-warming (runs in background)
  setTimeout(() => {
    prewarm.initializePrewarming(context).catch(err => {
      console.error('[PREWARM] Initialization error:', err);
    });
  }, 2000);

  // Create status bar item for showing active terminal status bar label
  agentStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  agentStatusBarItem.text = 'Agents';
  agentStatusBarItem.show();
  context.subscriptions.push(agentStatusBarItem);

  // Scan existing terminals in the editor area to register any agent terminals
  // Then restore persisted sessions with proper icons/titles
  terminals.scanExisting(
    (name, knownPrefix) => inferAgentConfigFromName(name, context.extensionPath, knownPrefix),
    context,
    (terminal) => startAutoLabelPollerForTerminal(terminal, context)
  )
    .then(() => restoreAgentTerminals(context))
    .catch(err => {
      console.error('[EXTENSION] Error scanning/restoring terminals:', err);
    });

  // Register terminals that appear after activation (e.g., restored sessions)
  context.subscriptions.push(
    vscode.window.onDidOpenTerminal(async (terminal) => {
      // Already tracked?
      if (terminals.getByTerminal(terminal)) {
        return;
      }

      // Use central identification with all available inputs
      const identOpts = extractTerminalIdentificationOptions(terminal);
      const info = getTerminalDisplayInfo(identOpts);
      if (!info.isAgent || !info.prefix) {
        return;
      }

      const agentConfig = inferAgentConfigFromName(terminal.name, context.extensionPath, info.prefix);
      if (!agentConfig) {
        return;
      }

      const id = identOpts.terminalId || terminals.nextId(info.prefix);
      let pid: number | undefined;
      try {
        pid = await terminal.processId;
      } catch {
        // ignore
      }

      terminals.register(terminal, id, agentConfig, pid, context, info.label || undefined);
      readiness.registerTerminal(terminal, { restored: true });

      if (identOpts.sessionId) {
        terminals.setSessionId(terminal, identOpts.sessionId);
        const agentType = prefixToAgentType(info.prefix);
        if (agentType) {
          terminals.setAgentType(terminal, agentType);
          startAutoLabelPollerForTerminal(terminal, context);
        }
      }
    })
  );

  registerTmuxCleanup(context);

  context.subscriptions.push(startWatchdog(context));

  // Ensure CLAUDE.md has Swarm instructions if Swarm is enabled
  claudemd.ensureSwarmInstructions();

  // Ensure symlinks exist for workspaces with .agents config
  for (const folder of vscode.workspace.workspaceFolders || []) {
    ensureSymlinksOnWorkspaceOpen(folder).catch(err => {
      console.error('[agents] Error ensuring symlinks:', err);
    });
  }

  // Watch for .agents config changes
  watchConfigFile(context, (workspaceFolder) => {
    ensureSymlinksOnWorkspaceOpen(workspaceFolder).catch(err => {
      console.error('[agents] Error ensuring symlinks on config change:', err);
    });
  });

  // Watch for user-level .agents config changes
  watchUserConfig(context, () => {
    for (const folder of vscode.workspace.workspaceFolders || []) {
      ensureSymlinksOnWorkspaceOpen(folder).catch(err => {
        console.error('[agents] Error ensuring symlinks on user config change:', err);
      });
    }
  });

  // Register URI handler for notification callbacks
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      async handleUri(uri: vscode.Uri) {
        const params = new URLSearchParams(uri.query);

        if (uri.path === '/focus') {
          const terminalId = params.get('terminalId');
          const entry = terminalId ? terminals.getById(terminalId) : undefined;
          if (entry) {
            entry.terminal.show();
          }
        }
      }
    })
  );

  // Register custom markdown editor
  try {
    context.subscriptions.push(
      AgentsMarkdownEditorProvider.register(context)
    );
  } catch (error) {
    // Editor already registered (hot reload) - continue activation
    console.log('Custom editor already registered, continuing...');
  }

  try {
    const currentSettings = settings.getSettings(context);
    await workbench.setMarkdownEditorAssociation(
      currentSettings.editor?.markdownViewerEnabled ?? true
    );
  } catch (error) {
    console.error('Failed to apply markdown editor association:', error);
  }

  // Load cached default agents if set
  const storedDefault = context.globalState.get<string>('agents.defaultAgentTitle');
  if (storedDefault) {
    defaultAgentTitle = storedDefault;
  }
  const storedSecondary = context.globalState.get<string>('agents.secondaryAgentTitle');
  if (storedSecondary) {
    secondaryAgentTitle = storedSecondary;
  } else {
    secondaryAgentTitle = CODEX_TITLE;
    context.globalState.update('agents.secondaryAgentTitle', CODEX_TITLE);
  }

  // Set initial context keys and subscribe to config changes
  await updateContextKeys(context);
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration('agents')) {
        await updateContextKeys(context);
      }
    })
  );

  // Run lightweight first-setup if needed
  await maybeRunFirstSetup(context);

  // Open Dashboard on startup if enabled (welcome screen)
  const agentSettings = settings.getSettings(context);
  if (agentSettings.showWelcomeScreen) {
    // Delay slightly to allow VS Code to fully initialize
    setTimeout(() => {
      settings.openPanel(context);
    }, 500);
  }

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('agents.open', () => openAgentTerminals(context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.openAgent', () => goToTerminal(context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.reopenLastSession', () => reopenLastClosedSession(context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.configure', () => settings.openPanel(context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.dispatchTask', () => settings.openPanelAndDispatch(context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.settings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', '@ext:agents');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.newAgent', async () => {
      // Default is always Claude
      const agentConfig = getBuiltInByTitle(context.extensionPath, defaultAgentTitle);
      if (agentConfig) {
        await openSingleAgent(context, agentConfig);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.newSecondaryAgent', async () => {
      const targetTitle = secondaryAgentTitle || defaultAgentTitle;
      const targetDef = getBuiltInDefByTitle(targetTitle);
      let agentConfig: Omit<AgentConfig, 'count'> | null = getBuiltInByTitle(context.extensionPath, targetTitle);
      if (targetDef?.key && !(await isAgentInstalled(targetDef.key))) {
        agentConfig = null;
      }
      if (!agentConfig) {
        agentConfig = getBuiltInByTitle(context.extensionPath, defaultAgentTitle);
      }
      if (agentConfig) {
        openSingleAgent(context, agentConfig);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.newAgentHSplit', async () => {
      const config = vscode.workspace.getConfiguration('agents');
      const enableTmux = config.get<boolean>('enableTmux', false);
      const terminal = vscode.window.activeTerminal;

      if (enableTmux && terminal && isTmuxTerminal(terminal)) {
        const state = getTmuxState(terminal);
        if (state) {
          const agentDef = getBuiltInByKey(state.agentType);
          const customAgent = !agentDef
            ? settings.getSettings(context).custom.find(agent => agent.name === state.agentType)
            : undefined;
          const command = agentDef?.command ?? customAgent?.command ?? '';
          tmuxSplitH(terminal, command);
        }
        return;
      }

      // Create horizontal split (new editor group below current)
      await vscode.commands.executeCommand('workbench.action.splitEditorDown');

      // Open default agent in the new (active) group
      const agentConfig = getBuiltInByTitle(context.extensionPath, defaultAgentTitle);
      if (agentConfig) {
        openSingleAgent(context, agentConfig);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.newAgentVSplit', async () => {
      const config = vscode.workspace.getConfiguration('agents');
      const enableTmux = config.get<boolean>('enableTmux', false);
      const terminal = vscode.window.activeTerminal;

      if (enableTmux && terminal && isTmuxTerminal(terminal)) {
        const state = getTmuxState(terminal);
        if (state) {
          const agentDef = getBuiltInByKey(state.agentType);
          const customAgent = !agentDef
            ? settings.getSettings(context).custom.find(agent => agent.name === state.agentType)
            : undefined;
          const command = agentDef?.command ?? customAgent?.command ?? '';
          tmuxSplitV(terminal, command);
        }
        return;
      }

      // Create vertical split (new editor group to the side)
      await vscode.commands.executeCommand('workbench.action.splitEditor');

      // Open default agent in the new (active) group
      const agentConfig = getBuiltInByTitle(context.extensionPath, defaultAgentTitle);
      if (agentConfig) {
        openSingleAgent(context, agentConfig);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.setTitle', () => setStatusBarLabelForActiveTerminal(context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.clear', () => clearActiveTerminal(context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.reload', () => reloadActiveTerminal(context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.autogit', git.generateCommitMessage)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.prompts', showPrompts)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.setupClaude', () => swarm.setupSwarmIntegrationForAgent('claude', context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.setupCodex', () => swarm.setupSwarmIntegrationForAgent('codex', context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.setupGemini', () => swarm.setupSwarmIntegrationForAgent('gemini', context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.enableNotifications', () => notifications.enableNotifications(context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.enableTmux', async () => {
      const config = vscode.workspace.getConfiguration();
      const current = config.get<boolean>('agents.enableTmux', false);
      await config.update('agents.enableTmux', !current, vscode.ConfigurationTarget.Global);
      const status = !current ? 'enabled' : 'disabled';
      vscode.window.showInformationMessage(`Tmux mode ${status}. New agent terminals will ${!current ? 'use tmux for per-tab splits' : 'use VS Code editor splits'}.`);
      await updateContextKeys(context);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.disableTmux', async () => {
      const config = vscode.workspace.getConfiguration();
      const current = config.get<boolean>('agents.enableTmux', false);
      if (current) {
        await config.update('agents.enableTmux', false, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage('Tmux mode disabled. New agent terminals will use VS Code editor splits.');
        await updateContextKeys(context);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.newTask', () => newTaskWithContext(context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.askAnotherAgent', () => askAnotherAgentFromTerminal(context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.handoff', () => handoffToAgent(context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.continueInNew', () => continueInNewSession(context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.sessionTrace', () => copySessionTrace(context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.sessionId', () => copySessionId())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.sessionResume', () => resumeSession(context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'agents.resumeCurrentInBestProfile',
      () => resumeCurrentInBestProfile(context)
    )
  );

  interface TerminalQuickPickItem extends vscode.QuickPickItem {
    terminal: vscode.Terminal;
  }

  // Disable session pre-warming
  context.subscriptions.push(
    vscode.commands.registerCommand('agents.disableWarming', async () => {
      const currentEnabled = prewarm.isEnabled(context);
      if (currentEnabled) {
        await prewarm.setEnabled(context, false);
        vscode.window.showInformationMessage('Session warming disabled.');
        await updateContextKeys(context);
      }
    })
  );

  // Agents: Init - create .agents config and symlinks
  context.subscriptions.push(
    vscode.commands.registerCommand('agents.init', async () => {
      const workspaceFolder = getActiveWorkspaceFolder();
      if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder open. Please open a folder first.');
        return;
      }

      // Create/open .agents config
      const config = await initWorkspaceConfig(workspaceFolder);
      if (!config) {
        return;
      }

      // Create symlinks codebase-wide
      const { created, errors } = await createSymlinksCodebaseWide(workspaceFolder, config);

      if (errors.length > 0) {
        vscode.window.showWarningMessage(`Created ${created} symlink(s), but ${errors.length} failed.`);
        console.error('[agents] Symlink errors:', errors);
      } else if (created > 0) {
        vscode.window.showInformationMessage(`Created ${created} symlink(s) in workspace.`);
      } else {
        vscode.window.showInformationMessage('.agents config ready. No new symlinks needed.');
      }
    })
  );

  // Register built-in individual agent commands
  for (const def of BUILT_IN_AGENTS) {
    context.subscriptions.push(
      vscode.commands.registerCommand(def.commandId, () => {
        const agentConfig = getBuiltInByTitle(context.extensionPath, def.title);
        if (agentConfig) {
          openSingleAgent(context, agentConfig);
        }
      })
    );
  }

  // Dynamically register custom agent commands
  const customAgentSettings = settings.getSettings(context);
  for (const custom of customAgentSettings.custom) {
    const commandId = `agents.new${custom.name.replace(/[^a-zA-Z0-9]/g, '')}`;
    const agentConfig = createAgentConfig(context.extensionPath, custom.name, custom.command, 'agents.png', custom.name.toLowerCase());

    context.subscriptions.push(
      vscode.commands.registerCommand(commandId, () => {
        openSingleAgent(context, agentConfig);
      })
    );

    console.log(`Registered custom agent command: ${commandId} for ${custom.name}`);
  }

  // Register the "New (Alias)" command - shows a QuickPick of all configured aliases
  context.subscriptions.push(
    vscode.commands.registerCommand('agents.newAlias', async () => {
      const currentSettings = settings.getSettings(context);
      const aliases = currentSettings.aliases || [];

      if (aliases.length === 0) {
        const action = await vscode.window.showInformationMessage(
          'No aliases configured. Create one in the Agents dashboard.',
          'Open Dashboard'
        );
        if (action === 'Open Dashboard') {
          vscode.commands.executeCommand('agents.configure');
        }
        return;
      }

      // Build QuickPick items
      const items = aliases.map(alias => {
        const builtInDef = getBuiltInByKey(alias.agent);
        const agentName = builtInDef ? getExpandedAgentName(builtInDef.prefix) : alias.agent;
        return {
          label: `${agentName} (${alias.name})`,
          description: alias.flags,
          alias
        };
      });

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select an alias to launch'
      });

      if (selected) {
        const builtInDef = getBuiltInByKey(selected.alias.agent);
        if (builtInDef) {
          const agentConfig = getBuiltInByTitle(context.extensionPath, builtInDef.title);
          if (agentConfig) {
            openSingleAgent(context, agentConfig, selected.alias.flags);
          }
        }
      }
    })
  );

  // Dynamically register command aliases
  // Aliases let users define shortcuts like "Agents: New Claude (Fast)" with custom flags
  const aliases = customAgentSettings.aliases || [];
  for (const alias of aliases) {
    // Get the built-in agent this alias is for
    const builtInDef = getBuiltInByKey(alias.agent);
    if (!builtInDef) {
      console.warn(`Alias "${alias.name}" references unknown agent: ${alias.agent}`);
      continue;
    }

    // Create command ID: agents.alias.Fast, agents.alias.MaxContext, etc.
    const commandId = `agents.alias.${alias.name.replace(/[^a-zA-Z0-9]/g, '')}`;
    const agentConfig = getBuiltInByTitle(context.extensionPath, builtInDef.title);

    if (agentConfig) {
      context.subscriptions.push(
        vscode.commands.registerCommand(commandId, () => {
          openSingleAgent(context, agentConfig, alias.flags);
        })
      );

      console.log(`Registered alias command: ${commandId} -> ${alias.agent} with flags: ${alias.flags}`);
    }
  }

  // Register quick launch commands (Cmd+Shift+1/2/3)
  const quickLaunch = customAgentSettings.quickLaunch;
  const quickLaunchSlots = [
    { command: 'agents.quickLaunch1', slot: quickLaunch?.slot1 },
    { command: 'agents.quickLaunch2', slot: quickLaunch?.slot2 },
    { command: 'agents.quickLaunch3', slot: quickLaunch?.slot3 },
  ];

  for (const { command, slot } of quickLaunchSlots) {
    context.subscriptions.push(
      vscode.commands.registerCommand(command, async () => {
        if (!slot) return; // Unconfigured = do nothing (silent)

        const builtInDef = getBuiltInByKey(slot.agent);
        if (!builtInDef) return;

        const agentConfig = getBuiltInByTitle(context.extensionPath, builtInDef.title);
        if (!agentConfig) return;

        let modelId = slot.model;
        if (!modelId && slot.modelAlias) {
          modelId = (await resolveAlias(slot.agent, slot.modelAlias)) ?? undefined;
        }
        const flags = modelId ? `--model ${modelId}` : undefined;
        openSingleAgent(context, agentConfig, flags);
      })
    );
  }

  // Listen for terminal closures to update our tracking
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((terminal) => {
      // Capture session info before unregistering (for reopen)
      const entry = terminals.getByTerminal(terminal);
      if (entry?.agentConfig && entry.sessionId) {
        terminals.pushClosedSession({
          terminalId: entry.id,
          prefix: entry.agentConfig.prefix,
          sessionId: entry.sessionId,
          label: entry.label,
          agentType: entry.agentType,
          agentConfig: entry.agentConfig,
          closedAt: Date.now()
        });
      }

      // Remove prewarm session mapping if exists
      if (entry?.id) {
        prewarm.removeTerminalSession(context, entry.id);
      }
      terminals.unregister(terminal);
    })
  );

  // Update status bar when active terminal changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTerminal((terminal) => {
      if (!agentStatusBarItem) return;

      if (!terminal) {
        agentStatusBarItem.text = 'Agents';
        return;
      }

      // Check if this is an agent terminal and scroll to bottom
      const agentInfo = identifyAgentTerminal(terminal, context.extensionPath);
      if (agentInfo.isAgent) {
        vscode.commands.executeCommand('workbench.action.terminal.scrollToBottom');

        // Try to fetch label on focus if not already set (immediate update instead of 5-min poller)
        tryFetchLabelOnFocus(terminal, context);
      }

      updateStatusBarForTerminal(terminal, context.extensionPath);

      // Update terminal titles based on focus state (for showLabelOnlyOnFocus feature)
      updateTerminalTitleOnFocus(terminal, context);
    })
  );

  // Update status bar when active editor changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (!agentStatusBarItem) return;

      if (editor) {
        // Switching to a real text editor - reset status bar
        agentStatusBarItem.text = 'Agents';
      } else {
        // editor is undefined - could be switching to a terminal tab
        // Check if active tab is a terminal and update status bar accordingly
        const activeGroup = vscode.window.tabGroups.activeTabGroup;
        const activeTab = activeGroup?.activeTab;

        if (activeTab?.input instanceof vscode.TabInputTerminal) {
          const terminalNames = vscode.window.terminals.map(t => t.name);
          const matchedName = findTerminalNameByTabLabel(terminalNames, activeTab.label);
          if (matchedName) {
            const matchedTerminal = vscode.window.terminals.find(t => t.name === matchedName);
            if (matchedTerminal) {
              updateStatusBarForTerminal(matchedTerminal, context.extensionPath);
              return;
            }
          }
        }
      }
    })
  );

  // Listen for tab changes to catch editor-area terminal switches
  // (onDidChangeActiveTerminal doesn't fire reliably for terminal editor tabs)
  // Debounced because onDidChangeTabs fires in rapid bursts during workspace restore,
  // tab drag, etc. — each fire used to trigger a full session-file read.
  let tabChangeTimer: ReturnType<typeof setTimeout> | undefined;
  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs(() => {
      if (!agentStatusBarItem) return;
      if (tabChangeTimer) clearTimeout(tabChangeTimer);
      tabChangeTimer = setTimeout(() => {
        tabChangeTimer = undefined;
        const activeGroup = vscode.window.tabGroups.activeTabGroup;
        const activeTab = activeGroup?.activeTab;

        if (!activeTab || !(activeTab.input instanceof vscode.TabInputTerminal)) {
          return;
        }

        const terminalNames = vscode.window.terminals.map(t => t.name);
        const matchedName = findTerminalNameByTabLabel(terminalNames, activeTab.label);
        if (!matchedName) return;
        const matchedTerminal = vscode.window.terminals.find(t => t.name === matchedName);
        if (!matchedTerminal) return;

        tryFetchLabelOnFocus(matchedTerminal, context);
        updateStatusBarForTerminal(matchedTerminal, context.extensionPath);
        updateTerminalTitleOnFocus(matchedTerminal, context);
      }, 120);
    })
  );
  context.subscriptions.push({
    dispose: () => {
      if (tabChangeTimer) clearTimeout(tabChangeTimer);
    },
  });

  // Auto-open terminals on startup if any agents have login enabled
  const startupSettings = settings.getSettings(context);
  if (hasLoginEnabled(startupSettings)) {
    setTimeout(() => openAgentTerminals(context), 1000);
  }
}

async function openSingleAgent(
  context: vscode.ExtensionContext,
  agentConfig: Omit<AgentConfig, 'count'>,
  additionalFlags?: string
) {
  const config = vscode.workspace.getConfiguration('agents');
  const enableTmux = config.get<boolean>('enableTmux', false);
  const tmuxOk = enableTmux ? await isTmuxAvailable() : false;

  if (enableTmux && !tmuxOk) {
    vscode.window.showWarningMessage('Tmux mode is enabled, but tmux is not available on PATH. Falling back to VS Code splits.');
  }

  // Build command with default model if configured
  const builtInDef = getBuiltInDefByTitle(agentConfig.title);
  const agentKey = builtInDef?.key as keyof AgentSettings['builtIn'] | undefined;
  let command = agentConfig.command || '';
  if (command) {
    // Only add default model if no explicit --model in additional flags
    if (agentKey && (!additionalFlags || !additionalFlags.includes('--model'))) {
      const defaultModel = settings.getDefaultModel(context, agentKey);
      if (defaultModel) {
        command = `${command} --model ${defaultModel}`;
      }
    }
    // Append additional flags from alias
    if (additionalFlags) {
      command = `${command} ${additionalFlags}`;
    }
  }

  // Handle session ID for supported agent types
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  let prewarmedSession: ReturnType<typeof prewarm.acquireSession> = null;
  let usePrewarmed = false;
  let sessionId: string | null = null;

  // Track OpenCode sessions before spawn to detect new one
  let opencodeSessionsBefore: string[] | null = null;
  if (agentKey === 'opencode') {
    opencodeSessionsBefore = await listOpencodeSessions(cwd);
  }

  if (agentKey && supportsPrewarming(agentKey) && !additionalFlags) {
    if (agentKey === 'claude') {
      // Claude: Generate session ID at open time, no prewarming needed
      sessionId = generateClaudeSessionId();
      command = buildClaudeOpenCommand(sessionId);
      usePrewarmed = true; // For tracking purposes
      console.log(`[PREWARM] Claude using on-demand session ID: ${sessionId}`);
    } else if (agentKey === 'opencode') {
      // OpenCode: Session ID will be detected after spawn
      // Just mark as using session tracking
      usePrewarmed = true;
      console.log(`[PREWARM] OpenCode session ID will be detected after spawn`);
    } else if (needsPrewarming(agentKey)) {
      // Codex/Gemini/Cursor: Use prewarmed session from pool
      prewarmedSession = prewarm.acquireSession(context, agentKey, cwd);
      if (prewarmedSession) {
        usePrewarmed = true;
        sessionId = prewarmedSession.sessionId;
        command = buildResumeCommand(prewarmedSession);
        console.log(`[PREWARM] Using pre-warmed ${agentKey} session: ${prewarmedSession.sessionId}`);
      }
    }
  }

  if (tmuxOk) {
    const title = buildTerminalTitle(agentConfig.title, undefined, context, sessionId);
    const terminalId = terminals.nextId(agentConfig.prefix);
    const agentType = builtInDef?.key ?? agentConfig.title;
    const terminal = createTmuxTerminal(
      title,
      agentType,
      command,
      {
        iconPath: agentConfig.iconPath as vscode.Uri,
        env: buildAgentTerminalEnv(terminalId, sessionId, cwd),
        viewColumn: vscode.ViewColumn.Active
      }
    );

    const pid = await terminal.processId;
    terminals.register(terminal, terminalId, agentConfig, pid, context);
    readiness.registerTerminal(terminal);
    if (command) {
      readiness.armAgentReady(terminal, agentKey && sessionId
        ? { agentKey, sessionId, cwd }
        : {});
    }

    // Track session ID and agent type for all terminals (not just prewarmed)
    if (sessionId) {
      terminals.setSessionId(terminal, sessionId);
      if (agentKey && supportsPrewarming(agentKey)) {
        terminals.setAgentType(terminal, agentKey);
        startAutoLabelPollerForTerminal(terminal, context);
      }
    }
    // Record prewarmed session separately
    if (usePrewarmed && sessionId && agentKey && supportsPrewarming(agentKey)) {
      await prewarm.recordTerminalSession(context, terminalId, sessionId, agentKey, cwd);
    }

    // OpenCode: Detect session ID asynchronously after spawn
    if (agentKey === 'opencode' && opencodeSessionsBefore !== null) {
      detectOpencodeSessionId(terminal, terminalId, cwd, opencodeSessionsBefore, context);
    }

    terminal.show();
    return;
  }

  const editorLocation: vscode.TerminalEditorLocationOptions = {
    viewColumn: vscode.ViewColumn.Active,
    preserveFocus: false
  };

  // Generate ID first for env var
  const terminalId = terminals.nextId(agentConfig.prefix);
  const title = buildTerminalTitle(agentConfig.title, undefined, context, sessionId);
  const terminal = vscode.window.createTerminal({
    iconPath: agentConfig.iconPath,
    location: editorLocation,
    name: title,
    env: buildAgentTerminalEnv(terminalId, sessionId, cwd),
    isTransient: true
  });

  const pid = await terminal.processId;
  terminals.register(terminal, terminalId, agentConfig, pid, context);
  readiness.registerTerminal(terminal);

  // Track session ID and agent type for all terminals (not just prewarmed)
  if (sessionId) {
    terminals.setSessionId(terminal, sessionId);
    if (agentKey && supportsPrewarming(agentKey)) {
      terminals.setAgentType(terminal, agentKey);
      startAutoLabelPollerForTerminal(terminal, context);
    }
  }
  // Record prewarmed session separately
  if (usePrewarmed && sessionId && agentKey && supportsPrewarming(agentKey)) {
    await prewarm.recordTerminalSession(context, terminalId, sessionId, agentKey, cwd);
  }

  if (command) {
    try {
      await readiness.waitFor(terminal, 'promptReady');
    } catch (err) {
      console.warn(`[READINESS] promptReady wait failed: ${err}. Sending command anyway.`);
    }
    if (terminal.shellIntegration) {
      terminal.shellIntegration.executeCommand(command);
    } else {
      terminal.sendText(command);
    }
    readiness.armAgentReady(terminal, agentKey && sessionId
      ? { agentKey, sessionId, cwd }
      : {});
  }

  // OpenCode: Detect session ID asynchronously after spawn
  // TODO: Implement detectOpencodeSessionId function
  if (agentKey === 'opencode' && opencodeSessionsBefore !== null) {
    // Session detection for OpenCode is handled elsewhere
  }
}

async function newTaskWithContext(context: vscode.ExtensionContext) {
  const agentSettings = settings.getSettings(context);
  const { tasks } = await tasksImport.fetchAllTasks(context, agentSettings.taskSources);

  let message: string;

  if (tasks.length === 0) {
    const userPrompt = await vscode.window.showInputBox({
      prompt: 'Enter task for the agent',
      placeHolder: 'What should the agent do?'
    });

    if (userPrompt === undefined) return;

    message = userPrompt;
  } else {
    interface TaskQuickPickItem extends vscode.QuickPickItem {
      task: typeof tasks[0];
    }

    const items: TaskQuickPickItem[] = tasks.map(task => {
      const badge = SOURCE_BADGES[task.source];
      const identifier = task.metadata.identifier;
      const description = identifier ? `${badge.label} ${identifier}` : badge.label;

      return {
        label: task.title,
        description,
        detail: task.description ? `${task.description.slice(0, 100)}${task.description.length > 100 ? '...' : ''}` : undefined,
        task
      };
    });

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a task to work on',
      matchOnDescription: true,
      matchOnDetail: true
    });

    if (!selected) return;

    const task = selected.task;
    message = task.title;

    if (task.description) {
      message += `\n\n${task.description}`;
    }

    if (task.metadata.url) {
      message += `\n\nReference: ${task.metadata.url}`;
    }
  }

  const clipboardText = await vscode.env.clipboard.readText();
  if (clipboardText && clipboardText.trim()) {
    message = `<context>\n${clipboardText.trim()}\n</context>\n\n${message}`;
  }

  const agentConfig = getBuiltInByTitle(context.extensionPath, defaultAgentTitle);
  if (agentConfig) {
    await openSingleAgentWithQueue(context, agentConfig, [message]);
  }
}

async function askAnotherAgentFromTerminal(context: vscode.ExtensionContext) {
  const clipboardText = (await vscode.env.clipboard.readText()).trim();
  if (!clipboardText) {
    vscode.window.showInformationMessage(
      'Copy the line first (Cmd+C), then press Cmd+Shift+K or right-click and choose "Start Task".'
    );
    return;
  }

  const preview = clipboardText.length > 80
    ? `${clipboardText.slice(0, 80).replace(/\s+/g, ' ')}...`
    : clipboardText.replace(/\s+/g, ' ');

  const question = await vscode.window.showInputBox({
    prompt: `Start a task with context: ${preview}`,
    placeHolder: 'What should the agent do?'
  });
  if (question === undefined || !question.trim()) return;

  const sourceTerminal = vscode.window.activeTerminal;
  const sourceEntry = sourceTerminal ? terminals.getByTerminal(sourceTerminal) : undefined;
  const sourceAgent = sourceEntry?.agentConfig
    ? getExpandedAgentName(sourceEntry.agentConfig.prefix)
    : undefined;
  const sourceSessionId = sourceEntry?.sessionId;
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  let sourceSummary: string | null = null;
  if (sourceSessionId) {
    sourceSummary = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'Loading source session summary…' },
      () => handoff.getSessionSummaryViaAgentsCli(sourceSessionId, workspacePath)
    );
  }

  const contextLines: string[] = [];
  if (sourceAgent) contextLines.push(`source-agent: ${sourceAgent}`);
  if (sourceSessionId) contextLines.push(`source-session-id: ${sourceSessionId}`);
  if (workspacePath) contextLines.push(`workspace: ${workspacePath}`);
  contextLines.push('selected-text:');
  contextLines.push(clipboardText);
  if (sourceSummary) {
    contextLines.push('');
    contextLines.push('source-session-summary:');
    contextLines.push(sourceSummary);
  }

  const message = `<context>\n${contextLines.join('\n')}\n</context>\n\n${question.trim()}`;
  const agentConfig = getBuiltInByTitle(context.extensionPath, defaultAgentTitle);
  if (agentConfig) {
    await openSingleAgentWithQueue(context, agentConfig, [message]);
  }
}

async function handoffToAgent(context: vscode.ExtensionContext) {
  const activeTerminal = vscode.window.activeTerminal;

  if (!activeTerminal) {
    vscode.window.showInformationMessage('No active terminal to handoff from');
    return;
  }

  const terminalEntry = terminals.getByTerminal(activeTerminal);

  if (!terminalEntry || !terminalEntry.agentConfig) {
    vscode.window.showInformationMessage('Active terminal is not an agent terminal');
    return;
  }

  const fromAgent = getExpandedAgentName(terminalEntry.agentConfig.prefix);
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  let messages: handoff.HandoffMessage[] = [];
  let planInfo: { path: string; content: string } | null = null;

  if (terminalEntry.sessionId && terminalEntry.agentType) {
    const agentType = terminalEntry.agentType as 'claude' | 'codex' | 'gemini';

    messages = await handoff.getSessionMessagesViaAgentsCli(terminalEntry.sessionId, 10, workspacePath);

    if (agentType === 'claude') {
      planInfo = await handoff.findRecentClaudePlan();
    }
  }

  if (messages.length === 0 && !planInfo && terminalEntry.agentType !== 'opencode') {
    vscode.window.showInformationMessage('No session history available for handoff');
    return;
  }

  interface AgentQuickPickItem extends vscode.QuickPickItem {
    agentKey: string;
    agentConfig: Omit<AgentConfig, 'count'>;
  }

  const agentItems: AgentQuickPickItem[] = [];

  for (const def of BUILT_IN_AGENTS) {
    if (def.key === 'shell') continue;
    if (def.title === terminalEntry.agentConfig.title) continue;

    const config = getBuiltInByTitle(context.extensionPath, def.title);
    if (!config) continue;

    const expandedName = getExpandedAgentName(def.prefix);
    agentItems.push({
      label: expandedName,
      description: def.key.toUpperCase(),
      agentKey: def.key,
      agentConfig: config
    });
  }

  const customAgentSettings = settings.getSettings(context);
  for (const custom of customAgentSettings.custom) {
    if (custom.name === terminalEntry.agentConfig.title) continue;

    agentItems.push({
      label: custom.name,
      description: 'Custom',
      agentKey: custom.name.toLowerCase(),
      agentConfig: createAgentConfig(context.extensionPath, custom.name, custom.command, 'agents.png', custom.name.toLowerCase())
    });
  }

  if (agentItems.length === 0) {
    vscode.window.showInformationMessage('No other agents available for handoff');
    return;
  }

  const selectedAgent = await vscode.window.showQuickPick(agentItems, {
    placeHolder: `Handoff from ${fromAgent} to...`,
    matchOnDescription: true
  });

  if (!selectedAgent) return;

  const handoffContext: handoff.HandoffContext = {
    fromAgent,
    messages,
    planContent: planInfo?.content,
    planPath: planInfo?.path
  };

  const prompt = handoff.formatHandoffPrompt(handoffContext);

  await openSingleAgentWithQueue(context, selectedAgent.agentConfig, [prompt]);
}

async function continueInNewSession(context: vscode.ExtensionContext) {
  const activeTerminal = vscode.window.activeTerminal;

  if (!activeTerminal) {
    vscode.window.showInformationMessage('No active terminal to continue from');
    return;
  }

  const terminalEntry = terminals.getByTerminal(activeTerminal);

  if (!terminalEntry || !terminalEntry.agentConfig) {
    vscode.window.showInformationMessage('Active terminal is not an agent terminal');
    return;
  }

  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  if (!terminalEntry.sessionId || !terminalEntry.agentType) {
    vscode.window.showInformationMessage('No session data available to continue from');
    return;
  }

  const [messages, toolStats] = await Promise.all([
    handoff.getSessionMessagesViaAgentsCli(terminalEntry.sessionId, 999, workspacePath),
    handoff.getSessionToolStatsViaAgentsCli(terminalEntry.sessionId, workspacePath)
  ]);

  const originalTask = messages.find(m => m.role === 'user')?.content ?? null;
  const lastResponse = [...messages].reverse().find(m => m.role === 'assistant')?.content ?? null;

  if (!originalTask && !lastResponse) {
    vscode.window.showInformationMessage('No session history available to continue from');
    return;
  }

  const continueCtx: handoff.ContinueContext = {
    originalTask,
    lastResponse,
    recentFiles: toolStats.recentFiles,
    toolCalls: toolStats.toolCalls,
    filesEdited: toolStats.filesEdited,
    filesRead: toolStats.filesRead
  };

  const prompt = handoff.formatContinuePrompt(continueCtx);

  await openSingleAgentWithQueue(context, terminalEntry.agentConfig, [prompt]);
}

interface CliSessionItem {
  id: string;
  shortId: string;
  agent: 'claude' | 'codex' | 'gemini' | 'opencode' | 'openclaw' | 'cursor';
  timestamp: string;
  version?: string;
  account?: string;
  project?: string;
  cwd?: string;
  filePath?: string;
  topic?: string;
  messageCount?: number;
  tokenCount?: number;
}

async function listSessionsViaCli(limit = 30): Promise<CliSessionItem[]> {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);
  const { stdout } = await execAsync(`agents sessions list --all -n ${limit} --json`, {
    maxBuffer: 10 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout);
  if (!Array.isArray(parsed)) return [];
  return parsed as CliSessionItem[];
}

function formatSessionWhen(timestamp: string): string {
  const ts = Date.parse(timestamp);
  if (!Number.isFinite(ts)) return '';
  const diffMs = Date.now() - ts;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function cleanSessionTopic(topic: string | undefined): string {
  if (!topic) return '(no topic)';
  return topic.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || '(no topic)';
}

interface SessionPickerOptions {
  title: string;
  placeholder: string;
  pinShortId?: string | null;
  pinLabel?: string;
}

async function pickSession(opts: SessionPickerOptions): Promise<CliSessionItem | null> {
  let sessions: CliSessionItem[];
  try {
    sessions = await listSessionsViaCli(30);
  } catch (err: any) {
    const msg = err?.stderr || err?.message || String(err);
    if (msg.includes('ENOENT') || msg.includes('not found')) {
      vscode.window.showInformationMessage('agents CLI not found. Install with: npm i -g @swarmify/agents-cli');
    } else {
      vscode.window.showInformationMessage(`Failed to list sessions: ${msg.slice(0, 120)}`);
    }
    return null;
  }

  if (sessions.length === 0) {
    vscode.window.showInformationMessage('No sessions found');
    return null;
  }

  if (opts.pinShortId) {
    const idx = sessions.findIndex(s => s.shortId === opts.pinShortId || s.id === opts.pinShortId);
    if (idx > 0) {
      const [pinned] = sessions.splice(idx, 1);
      sessions.unshift(pinned);
    }
  }

  interface SessionQuickPickItem extends vscode.QuickPickItem {
    session: CliSessionItem;
  }

  const items: SessionQuickPickItem[] = sessions.map((s, idx) => {
    const agentLabel = s.version ? `${s.agent}@${s.version}` : s.agent;
    const when = formatSessionWhen(s.timestamp);
    const topic = cleanSessionTopic(s.topic);
    const isPinned = idx === 0 && opts.pinShortId &&
      (s.shortId === opts.pinShortId || s.id === opts.pinShortId);
    const pinTag = isPinned && opts.pinLabel ? `$(pinned) ${opts.pinLabel} · ` : '';
    return {
      label: `${pinTag}${s.shortId}  ${topic}`,
      description: `${agentLabel} · ${when}${s.account ? ` · ${s.account}` : ''}`,
      detail: `${s.project || '-'}${s.cwd ? `  ${s.cwd}` : ''}`,
      session: s,
    };
  });

  const picked = await vscode.window.showQuickPick<SessionQuickPickItem>(items, {
    title: opts.title,
    placeHolder: opts.placeholder,
    matchOnDescription: true,
    matchOnDetail: true,
  });

  return picked?.session ?? null;
}

async function copySessionTrace(_context: vscode.ExtensionContext) {
  const activeTerminal = vscode.window.activeTerminal;
  const terminalEntry = activeTerminal ? terminals.getByTerminal(activeTerminal) : null;
  const currentSessionId = terminalEntry?.sessionId ?? null;
  const currentShortId = currentSessionId ? currentSessionId.slice(0, 8) : null;

  const session = await pickSession({
    title: 'Agents: Session Trace',
    placeholder: 'Pick a session to copy its trace to clipboard',
    pinShortId: currentShortId,
    pinLabel: 'Current',
  });
  if (!session) return;

  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  try {
    const { stdout } = await execAsync(`agents sessions view ${session.id} --trace`, {
      maxBuffer: 10 * 1024 * 1024,
      cwd: workspacePath,
    });

    const lines = stdout.split('\n');
    const headerEnd = lines.findIndex(l => l.startsWith('# '));
    const trace = headerEnd >= 0 ? lines.slice(headerEnd).join('\n') : stdout;

    const agentLabel = session.version ? `${session.agent}@${session.version}` : session.agent;
    const header = [
      `## Session`,
      `- Agent: ${agentLabel}`,
      `- Session ID: ${session.id}`,
      session.cwd ? `- Directory: ${session.cwd}` : '',
      session.account ? `- Account: ${session.account}` : '',
    ].filter(Boolean).join('\n');

    const fullTrace = `${header}\n\n${trace}`;
    await vscode.env.clipboard.writeText(fullTrace);
    vscode.window.setStatusBarMessage(`Session trace copied (${session.shortId})`, 3000);
  } catch (err: any) {
    const msg = err?.message || 'Unknown error';
    vscode.window.showInformationMessage(`Failed to get session trace: ${msg.slice(0, 120)}`);
  }
}

async function copySessionId() {
  const activeTerminal = vscode.window.activeTerminal;

  if (!activeTerminal) {
    vscode.window.showInformationMessage('No active terminal');
    return;
  }

  const terminalEntry = terminals.getByTerminal(activeTerminal);

  if (!terminalEntry || !terminalEntry.agentConfig) {
    vscode.window.showInformationMessage('Active terminal is not an agent terminal');
    return;
  }

  if (!terminalEntry.sessionId) {
    vscode.window.showInformationMessage('No session ID available');
    return;
  }

  await vscode.env.clipboard.writeText(terminalEntry.sessionId);
  vscode.window.setStatusBarMessage(`Session ID copied: ${terminalEntry.sessionId.slice(0, 8)}...`, 3000);
}

function buildVersionedResumeCommand(
  agentType: PrewarmAgentType,
  sessionId: string,
  version?: string,
): string {
  const config = PREWARM_CONFIGS[agentType];
  const baseCmd = config.resumeCommand(sessionId);
  if (!version) return baseCmd;
  const cmdName = config.command;
  const prefix = new RegExp(`^${cmdName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  return baseCmd.replace(prefix, `${cmdName}@${version}`);
}

function agentKeyFromSession(agent: CliSessionItem['agent']): PrewarmAgentType | null {
  if (agent === 'claude' || agent === 'codex' || agent === 'gemini' ||
      agent === 'opencode' || agent === 'cursor') {
    return agent;
  }
  return null;
}

async function resumeSession(context: vscode.ExtensionContext) {
  const activeTerminal = vscode.window.activeTerminal;
  const terminalEntry = activeTerminal ? terminals.getByTerminal(activeTerminal) : null;
  const currentSessionId = terminalEntry?.sessionId ?? null;
  const currentShortId = currentSessionId ? currentSessionId.slice(0, 8) : null;

  const session = await pickSession({
    title: 'Agents: Session Resume',
    placeholder: 'Pick a session to resume in a new terminal',
    pinShortId: currentShortId,
    pinLabel: 'Current',
  });
  if (!session) return;

  const agentKey = agentKeyFromSession(session.agent);
  if (!agentKey) {
    vscode.window.showInformationMessage(`Cannot resume sessions of type ${session.agent}`);
    return;
  }

  const builtIn = BUILT_IN_AGENTS.find(a => a.key === agentKey);
  if (!builtIn) {
    vscode.window.showInformationMessage(`No built-in agent config for ${agentKey}`);
    return;
  }

  const agentConfig = createAgentConfig(
    context.extensionPath,
    builtIn.title,
    builtIn.command,
    builtIn.icon,
    builtIn.prefix,
  );

  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  const resumeCmd = buildVersionedResumeCommand(agentKey, session.id, session.version);

  const terminalId = terminals.nextId(builtIn.prefix);
  const title = buildTerminalTitle(agentConfig.title, undefined, context, session.id);
  const terminal = vscode.window.createTerminal({
    iconPath: agentConfig.iconPath,
    location: { viewColumn: vscode.ViewColumn.Active },
    name: title,
    env: buildAgentTerminalEnv(terminalId, session.id, workspacePath),
    isTransient: true,
  });

  const pid = await terminal.processId;
  terminals.register(terminal, terminalId, agentConfig, pid, context);
  readiness.registerTerminal(terminal);
  terminals.setSessionId(terminal, session.id);
  terminals.setAgentType(terminal, agentKey);
  startAutoLabelPollerForTerminal(terminal, context);

  try {
    await readiness.waitFor(terminal, 'promptReady');
  } catch (err) {
    console.warn(`[READINESS] promptReady wait failed: ${err}`);
  }
  if (terminal.shellIntegration) {
    terminal.shellIntegration.executeCommand(resumeCmd);
  } else {
    terminal.sendText(resumeCmd);
  }
  readiness.armAgentReady(terminal, {
    agentKey,
    sessionId: session.id,
    cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
  });

  terminal.show();
  vscode.window.setStatusBarMessage(`Resuming ${agentKey}${session.version ? `@${session.version}` : ''} · ${session.shortId}`, 3000);
}

async function fetchAgentsViewJson(agentKey: PrewarmAgentType): Promise<AgentsViewJsonAgent | null> {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);
  try {
    const { stdout } = await execAsync(`agents view ${agentKey} --json`, {
      maxBuffer: 5 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout) as AgentsViewJsonAgent;
    if (!parsed || !Array.isArray(parsed.versions)) return null;
    return parsed;
  } catch (err: any) {
    const msg = err?.stderr || err?.message || String(err);
    if (msg.includes('unknown option') || msg.includes('--json')) {
      vscode.window.showInformationMessage(
        'Needs @swarmify/agents-cli >= 1.13.0. Run: npm i -g @swarmify/agents-cli'
      );
    } else {
      vscode.window.showInformationMessage(`Failed to query agents view: ${msg.slice(0, 120)}`);
    }
    return null;
  }
}

async function resumeCurrentInBestProfile(context: vscode.ExtensionContext) {
  const activeTerminal = vscode.window.activeTerminal;
  if (!activeTerminal) {
    vscode.window.showInformationMessage('No active terminal');
    return;
  }
  const terminalEntry = terminals.getByTerminal(activeTerminal);
  if (!terminalEntry?.sessionId) {
    vscode.window.showInformationMessage('Active terminal has no session to resume');
    return;
  }

  const agentKey = terminalEntry.agentType
    || prefixToAgentType(terminalEntry.agentConfig?.prefix ?? null);
  if (!agentKey) {
    vscode.window.showInformationMessage('Active terminal is not a supported agent');
    return;
  }

  const data = await fetchAgentsViewJson(agentKey);
  if (!data) return;

  // If the active terminal already sits on a version that still has usage,
  // there's nothing to do — "best" is really "any version with usage", so
  // a usable current version IS the best. Skip the terminal churn and the
  // /continue round-trip. Undefined version falls through to the legacy
  // switch path (we can't reason about untagged terminals).
  const currentVersion = terminalEntry.version;
  if (currentVersion) {
    const currentVersionData = data.versions.find(v => v.version === currentVersion);
    if (isVersionStillUsable(currentVersionData)) {
      activeTerminal.show();
      vscode.window.setStatusBarMessage(
        `Already on ${agentKey}@${currentVersion} · ${sessionUsedPercent(currentVersionData!)}% session`,
        3000
      );
      console.log(`[RESUME-IN-BEST] skipping switch — active terminal already on usable version ${agentKey}@${currentVersion}`);
      return;
    }
  }

  const best = pickBestVersion(data.versions);
  if (!best) {
    vscode.window.showInformationMessage(
      `No signed-in ${agentKey} versions available. Run: agents add ${agentKey}@latest`
    );
    return;
  }

  const builtIn = BUILT_IN_AGENTS.find(a => a.key === agentKey);
  if (!builtIn) {
    vscode.window.showInformationMessage(`No built-in agent config for ${agentKey}`);
    return;
  }

  const agentConfig = createAgentConfig(
    context.extensionPath,
    builtIn.title,
    builtIn.command,
    builtIn.icon,
    builtIn.prefix,
  );

  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

  // The OLD session id lives in the terminal we're resuming FROM — it
  // belongs to whatever version's home originally created it. We pass
  // this to /continue so the new agent loads that transcript.
  const oldSessionId = terminalEntry.sessionId;

  // Generate a NEW session id for the fresh claude process. Passing it
  // via `--session-id` does two things:
  //   1. Claude creates its jsonl at a path readiness can predict, so
  //      fs.watch fires `agentReady` the moment the TUI is live — much
  //      more reliable than polling process state, which was firing
  //      during the shim/node startup window BEFORE Claude was actually
  //      accepting input (that's why /continue was landing at zsh).
  //   2. The terminal's AGENT_SESSION_ID stays consistent with the UUID
  //      Claude actually uses, so session tracking doesn't drift.
  // Only Claude supports `--session-id` right now; other agents fall
  // back to reusing the old id and the generic ps/pgrep probe.
  const supportsSessionIdFlag = agentKey === 'claude';
  const newSessionId = supportsSessionIdFlag ? randomUUID() : oldSessionId;
  const launchCmd = buildLaunchCommand(
    builtIn.command,
    best.version,
    agentKey,
    supportsSessionIdFlag ? newSessionId : null,
  );

  const terminalId = terminals.nextId(builtIn.prefix);
  const title = buildTerminalTitle(agentConfig.title, undefined, context, newSessionId);
  const terminal = vscode.window.createTerminal({
    iconPath: agentConfig.iconPath,
    location: { viewColumn: vscode.ViewColumn.Active },
    name: title,
    env: buildAgentTerminalEnv(terminalId, newSessionId, workspacePath, best.version),
    isTransient: true,
  });

  const pid = await terminal.processId;
  terminals.register(terminal, terminalId, agentConfig, pid, context);
  readiness.registerTerminal(terminal);
  terminals.setSessionId(terminal, newSessionId);
  terminals.setAgentType(terminal, agentKey);
  terminals.setVersion(terminal, best.version);
  startAutoLabelPollerForTerminal(terminal, context);

  // /continue takes the OLD session id (the transcript we want to load),
  // not the new one (which is just the container for the fresh process).
  // Prefer the /continue slash command if it's synced to this version's
  // home; otherwise inline the full instructions.
  const versionHomeCommand = path.join(
    os.homedir(), '.agents', 'versions', agentKey, best.version,
    'home', '.claude', 'commands', 'continue.md'
  );
  const hasContinueCmd = fsSync.existsSync(versionHomeCommand);

  let centralContinueMdBody: string | null = null;
  if (!hasContinueCmd) {
    const centralCommand = path.join(os.homedir(), '.agents', 'commands', 'continue.md');
    try {
      centralContinueMdBody = fsSync.readFileSync(centralCommand, 'utf-8');
    } catch {
      centralContinueMdBody = null;
    }
  }
  const resumeInput = buildResumeInput(oldSessionId, hasContinueCmd, centralContinueMdBody);

  const t0 = Date.now();
  const elapsed = () => `t+${Date.now() - t0}ms`;
  console.log(`[RESUME-IN-BEST] ${elapsed()} starting — agent=${agentKey}@${best.version} oldSession=${oldSessionId.slice(0, 8)} newSession=${newSessionId.slice(0, 8)} cmdSynced=${hasContinueCmd}`);

  try {
    await readiness.waitFor(terminal, 'promptReady');
    console.log(`[RESUME-IN-BEST] ${elapsed()} promptReady — sending launch: ${launchCmd}`);
  } catch (err) {
    console.warn(`[RESUME-IN-BEST] ${elapsed()} promptReady wait FAILED: ${err} — sending launch anyway`);
  }
  terminal.sendText(launchCmd);
  // Pass the NEW session id so readiness can watch for its jsonl file
  // appearing — that's the signal that Claude's TUI is live and accepting
  // input on the pty.
  readiness.armAgentReady(terminal, {
    agentKey,
    sessionId: newSessionId,
    cwd: workspacePath,
  });
  terminal.show();

  // Send the resume input only after the agent CLI is actually idle on the
  // pty. Replaces a hardcoded 6s guess that was unreliable on slow machines
  // (never enough) and wasteful on fast ones (always too much).
  // Claude Code's TUI uses Ink (React for CLI) which puts stdin in raw mode
  // and watches for `\r` as Enter. VS Code's `sendText(text, true)` appends
  // `\n` on macOS, which types into the input box but does NOT submit.
  // Explicit two-step: type the payload with shouldExecute=false, then
  // separately send `\r` to signal Enter. Precedent: tmux.ts:71 uses tmux's
  // `send-keys … Enter` keyword for the same reason.
  const submitToTui = () => {
    terminal.sendText(resumeInput, false);
    terminal.sendText('\r', false);
  };
  readiness.waitFor(terminal, 'agentReady').then(
    () => {
      console.log(`[RESUME-IN-BEST] ${elapsed()} agentReady — sending resume input (${resumeInput.length} chars): ${resumeInput.slice(0, 80)}${resumeInput.length > 80 ? '…' : ''}`);
      submitToTui();
    },
    (err) => {
      console.warn(`[RESUME-IN-BEST] ${elapsed()} agentReady wait FAILED: ${err} — sending resume input anyway`);
      submitToTui();
    },
  );

  const acct = best.email ? ` (${best.email})` : '';
  const usage = `${sessionUsedPercent(best)}% session`;
  vscode.window.setStatusBarMessage(
    `Resumed ${agentKey}@${best.version}${acct} · ${usage} · ${newSessionId.slice(0, 8)}`,
    5000
  );
}

interface TerminalQuickPickItem extends vscode.QuickPickItem {
  terminal: vscode.Terminal;
}

async function getSessionPreviewForEntry(
  entry: terminals.EditorTerminal,
  workspacePath?: string
): Promise<{ firstUserMessage?: string; lastUserMessage?: string; lastActivityMs?: number; messageCount: number } | null> {
  if (!entry.sessionId) return null;
  const agentType = entry.agentType || prefixToAgentType(entry.agentConfig?.prefix ?? null);
  if (!agentType) return null;

  const sessionPath = await getSessionPathBySessionId(
    entry.sessionId,
    agentType,
    workspacePath
  );
  if (!sessionPath) return null;

  if (agentType === 'opencode') {
    return await getOpenCodeSessionPreviewInfo(sessionPath);
  }
  if (agentType === 'cursor') {
    return await getCursorSessionPreviewInfo(sessionPath);
  }
  return await getSessionPreviewInfo(sessionPath);
}

async function goToTerminal(context: vscode.ExtensionContext) {
  const allEntries = terminals.getAllTerminals();
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  const items: TerminalQuickPickItem[] = [];
  const previewPromises: Array<{ itemIndex: number; entry: terminals.EditorTerminal; promise: Promise<{ firstUserMessage?: string; lastUserMessage?: string; lastActivityMs?: number; messageCount: number } | null> }> = [];

  const display = getDisplayPrefs(context);
  const extensionPath = context.extensionPath;

  for (const entry of allEntries) {
    if (!entry.agentConfig) continue;

    const effectiveTitle = entry.label || entry.autoLabel || 'Untitled';
    const itemIndex = items.length;

    items.push({
      label: effectiveTitle,
      description: '',
      detail: '',
      iconPath: buildIconPath(entry.agentConfig.title, extensionPath) ?? undefined,
      terminal: entry.terminal
    });

    if (entry.sessionId) {
      previewPromises.push({
        itemIndex,
        entry,
        promise: getSessionPreviewForEntry(entry, workspacePath)
      });
    }
  }

  if (items.length === 0) {
    vscode.window.showInformationMessage('No agent terminals open');
    return;
  }

  const previewResults = await Promise.all(previewPromises.map(p => p.promise));
  for (let i = 0; i < previewPromises.length; i++) {
    const previewPromise = previewPromises[i];
    const entry = previewPromise.entry;
    const idx = previewPromise.itemIndex;
    const info = previewResults[i];
    if (info) {
      if (!entry.label && !entry.autoLabel && info.firstUserMessage) {
        const words = extractFirstNWords(info.firstUserMessage, 5);
        const ticket = extractLinearTicketId(info.firstUserMessage);
        const generatedTitle = ticket && words ? `${ticket} ${words}` : (ticket ?? words);
        if (generatedTitle) {
          terminals.setAutoLabel(entry.terminal, generatedTitle);
          items[idx].label = generatedTitle;
        }
      }

      if (info.lastActivityMs) {
        const diffMs = Date.now() - info.lastActivityMs;
        items[idx].description = diffMs < 60_000 ? 'Just now' : formatRelativeTime(info.lastActivityMs);
      }

      const parts: string[] = [];
      if (info.firstUserMessage) parts.push(truncateText(info.firstUserMessage, 80));
      if (info.messageCount > 0) parts.push(`(${info.messageCount})`);
      items[idx].detail = parts.join(' ');
    }
  }

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Go to terminal',
    matchOnDescription: true,
    matchOnDetail: true
  });

  if (selected) {
    selected.terminal.show();
  }
}

export async function openSingleAgentWithQueue(
  context: vscode.ExtensionContext,
  agentConfig: Omit<AgentConfig, 'count'>,
  messages: string[]
) {
  const editorLocation: vscode.TerminalEditorLocationOptions = {
    viewColumn: vscode.ViewColumn.Active,
    preserveFocus: false
  };

  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  const terminalId = terminals.nextId(agentConfig.prefix);

  // Determine agent key and handle session ID
  const builtInDef = getBuiltInByPrefix(agentConfig.prefix);
  const agentKey = builtInDef?.key as 'claude' | 'codex' | 'gemini' | 'opencode' | 'cursor' | undefined;

  let command = agentConfig.command;
  let sessionId: string | null = null;

  if (agentKey && supportsPrewarming(agentKey)) {
    if (agentKey === 'claude') {
      // Claude: Generate session ID at open time
      sessionId = generateClaudeSessionId();
      command = buildClaudeOpenCommand(sessionId);
    } else if (needsPrewarming(agentKey)) {
      // Codex/Gemini/Cursor: Use prewarmed session from pool
      const prewarmedSession = prewarm.acquireSession(context, agentKey, cwd);
      if (prewarmedSession) {
        sessionId = prewarmedSession.sessionId;
        command = buildResumeCommand(prewarmedSession);
      }
    }
  }

  const title = buildTerminalTitle(agentConfig.title, undefined, context, sessionId);
  const terminal = vscode.window.createTerminal({
    iconPath: agentConfig.iconPath,
    location: editorLocation,
    name: title,
    env: buildAgentTerminalEnv(terminalId, sessionId, cwd),
    isTransient: true
  });

  const pid = await terminal.processId;
  terminals.register(terminal, terminalId, agentConfig, pid, context);

  // Track session ID and agent type
  if (sessionId && agentKey && supportsPrewarming(agentKey)) {
    terminals.setSessionId(terminal, sessionId);
    terminals.setAgentType(terminal, agentKey);
    await prewarm.recordTerminalSession(context, terminalId, sessionId, agentKey, cwd);
  }

  // Pull focus from the webview so the terminal tab becomes the visible one.
  terminal.show(false);

  // Queue messages
  for (const msg of messages) {
    terminals.queueMessage(terminal, msg);
  }

  // Send agent command
  if (command) {
    terminal.sendText(command);
  }

  // After delay, send queued messages (5s to ensure agent process fully loaded).
  // Ink TUIs (Claude) watch for `\r` as Enter; `sendText(text, true)` appends
  // `\n` which types into the input but does NOT submit. See the resume flow
  // around line 2086 for the same workaround.
  setTimeout(() => {
    const queued = terminals.flushQueue(terminal);
    for (const msg of queued) {
      terminal.sendText(msg, false);
      terminal.sendText('\r', false);
    }
  }, 5000);
}

async function openAgentTerminals(context: vscode.ExtensionContext) {
  const agents = getAgentsToOpen(context);

  if (agents.length === 0) {
    vscode.window.showInformationMessage('No agents configured to open on login. Use "Agents" to configure.');
    return;
  }

  const editorLocation: vscode.TerminalEditorLocationOptions = {
    viewColumn: vscode.ViewColumn.Active,
    preserveFocus: false
  };

  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  let totalCount = 0;

  for (const agent of agents) {
    for (let i = 0; i < agent.count; i++) {
      // Generate ID first for env var
      const terminalId = terminals.nextId(agent.prefix);

      // Determine agent key and handle session ID
      const builtInDef = getBuiltInByPrefix(agent.prefix);
      const agentKey = builtInDef?.key as 'claude' | 'codex' | 'gemini' | undefined;

      let command = agent.command;
      let sessionId: string | null = null;

      if (agentKey && supportsPrewarming(agentKey)) {
        if (agentKey === 'claude') {
          // Claude: Generate session ID at open time
          sessionId = generateClaudeSessionId();
          command = buildClaudeOpenCommand(sessionId);
          console.log(`[PREWARM] Auto-open Claude with session ID: ${sessionId}`);
        } else if (needsPrewarming(agentKey)) {
          // Codex/Gemini: Use prewarmed session from pool
          const prewarmedSession = prewarm.acquireSession(context, agentKey, cwd);
          if (prewarmedSession) {
            sessionId = prewarmedSession.sessionId;
            command = buildResumeCommand(prewarmedSession);
            console.log(`[PREWARM] Auto-open ${agentKey} with pre-warmed session: ${sessionId}`);
          }
        }
      }

      const title = buildTerminalTitle(agent.title, undefined, context, sessionId);

      const terminal = vscode.window.createTerminal({
        iconPath: agent.iconPath,
        location: editorLocation,
        name: title,
        env: buildAgentTerminalEnv(terminalId, sessionId, cwd),
        isTransient: true
      });

      const pid = await terminal.processId;
      terminals.register(terminal, terminalId, agent, pid, context);
      readiness.registerTerminal(terminal);

      // Track session ID
      if (sessionId && agentKey && supportsPrewarming(agentKey)) {
        terminals.setSessionId(terminal, sessionId);
        terminals.setAgentType(terminal, agentKey);
        startAutoLabelPollerForTerminal(terminal, context);
        await prewarm.recordTerminalSession(context, terminalId, sessionId, agentKey, cwd);
      }

      if (command) {
        try {
          await readiness.waitFor(terminal, 'promptReady');
        } catch (err) {
          console.warn(`[READINESS] promptReady wait failed: ${err}`);
        }
        if (terminal.shellIntegration) {
          terminal.shellIntegration.executeCommand(command);
        } else {
          terminal.sendText(command);
        }
        readiness.armAgentReady(terminal, agentKey && sessionId
          ? { agentKey, sessionId, cwd }
          : {});
      }
      totalCount++;
    }
  }

  if (totalCount > 0) {
    vscode.window.showInformationMessage(`Opened ${totalCount} agent terminal${totalCount > 1 ? 's' : ''}`);
  }
}

/**
 * Fetch and set auto-label from first user message in session file.
 * Only fetches if sessionId exists but autoLabel is not set.
 *
 * Supported agents: claude, codex, gemini, opencode, cursor
 */
async function fetchAndSetAutoLabel(terminal: vscode.Terminal, entry: terminals.EditorTerminal): Promise<string | undefined> {
  if (!entry.sessionId || entry.autoLabel) return entry.autoLabel;

  try {
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const previewInfo = await getSessionPreviewForEntry(entry, workspacePath);
    if (!previewInfo) return undefined;

    if (!previewInfo.firstUserMessage) return undefined;

    const words = extractFirstNWords(previewInfo.firstUserMessage, 5);
    const ticket = extractLinearTicketId(previewInfo.firstUserMessage);
    const autoLabel = ticket && words ? `${ticket} ${words}` : (ticket ?? words);
    if (autoLabel) {
      terminals.setAutoLabel(terminal, autoLabel);
    }
    return autoLabel ?? undefined;
  } catch {
    return undefined;
  }
}

function startAutoLabelPollerForTerminal(terminal: vscode.Terminal, context: vscode.ExtensionContext): void {
  const display = getDisplayPrefs(context);
  if (!display.autoLabelInTabTitles) return;

  const entry = terminals.getByTerminal(terminal);
  if (!entry || entry.label || entry.autoLabel) return;
  if (!entry.sessionId || !entry.agentType) return;

  terminals.startAutoLabelPoller(terminal, async () => {
    const autoLabel = await fetchAndSetAutoLabel(terminal, entry);
    if (autoLabel && vscode.window.activeTerminal === terminal) {
      updateStatusBarForTerminal(terminal, context.extensionPath);
    }
  });
}

/**
 * Try to fetch and set the auto-label when terminal gains focus.
 * This provides immediate label update instead of waiting for the 5-minute poller.
 * Also updates the terminal tab title if showLabelsInTitles is enabled.
 */
async function tryFetchLabelOnFocus(
  terminal: vscode.Terminal,
  context: vscode.ExtensionContext
): Promise<void> {
  const entry = terminals.getByTerminal(terminal);
  if (!entry) return;

  // Skip if already has a label
  if (entry.label || entry.autoLabel) return;

  // Need sessionId and agentType to fetch label
  if (!entry.sessionId || !entry.agentType) return;

  // Fetch the label from session file
  const autoLabel = await fetchAndSetAutoLabel(terminal, entry);
  if (!autoLabel) return;

  // Update status bar
  updateStatusBarForTerminal(terminal, context.extensionPath);

  // Update terminal tab title if showLabelsInTitles is enabled
  const display = getDisplayPrefs(context);
  if (display.showLabelsInTitles && display.autoLabelInTabTitles && entry.agentConfig) {
    const newTitle = buildTerminalTitle(
      entry.agentConfig.title,
      autoLabel,
      context,
      entry.sessionId
    );
    await terminals.renameTerminal(terminal, newTitle);
  }
}

function updateStatusBarForTerminal(terminal: vscode.Terminal, extensionPath: string) {
  if (!agentStatusBarItem) return;

  const entry = terminals.getByTerminal(terminal);
  const info = identifyAgentTerminal(terminal, extensionPath);

  // If this is an agent terminal, show its name
  // Format: "Agents: Claude - <Label> (full-uuid)"
  if (info.isAgent && info.prefix) {
    const expandedName = getExpandedAgentName(info.prefix);
    const sessionId = entry?.sessionId;

    // Show immediate status bar with current data
    const rawLabel = entry?.label || entry?.autoLabel;
    const displayLabel = rawLabel ? rawLabel.replace(/<[^>]*>/g, '').trim() : null;
    let text = `Agents: ${expandedName}`;
    if (displayLabel) {
      text += ` - ${displayLabel}`;
    }
    if (sessionId) {
      text += ` (${sessionId})`;
    }
    agentStatusBarItem.text = text;

    // If no label/autoLabel but we have sessionId, fetch auto-label async
    if (!displayLabel && entry?.sessionId && entry.agentType) {
      fetchAndSetAutoLabel(terminal, entry).then(autoLabel => {
        if (autoLabel && agentStatusBarItem && vscode.window.activeTerminal === terminal) {
          const cleanAutoLabel = autoLabel.replace(/<[^>]*>/g, '').trim();
          let updatedText = `Agents: ${expandedName}`;
          updatedText += ` - ${cleanAutoLabel}`;
          if (sessionId) {
            updatedText += ` (${sessionId})`;
          }
          agentStatusBarItem.text = updatedText;
        }
      }).catch(() => { /* swallow to prevent unhandled rejection */ });
    }
    return;
  }

  // Not an agent terminal - show "Terminal" for regular shells
  agentStatusBarItem.text = 'Agents: Terminal';
}

function setStatusBarLabelForActiveTerminal(context: vscode.ExtensionContext) {
  const terminal = vscode.window.activeTerminal;
  if (!terminal) {
    vscode.window.showInformationMessage('No active terminal to set status bar label.');
    return;
  }

  const info = identifyAgentTerminal(terminal, context.extensionPath);
  if (!info.isAgent) {
    vscode.window.showInformationMessage('This terminal is not an agent terminal.');
    return;
  }

  const currentLabel = info.label ?? '';

  vscode.window.showInputBox({
    prompt: 'Set a status bar label for this agent',
    placeHolder: 'Status bar label (max 5 words)',
    value: currentLabel
  }).then(async (input) => {
    if (input === undefined) {
      return;
    }

    // Ensure terminal is registered before setting label
    let entry = terminals.getByTerminal(terminal);
    if (!entry && info.prefix) {
      const def = getBuiltInDefByTitle(info.prefix);
      if (def) {
        const agentConfig = createAgentConfig(context.extensionPath, def.title, def.command, def.icon, def.prefix);
        const id = terminals.nextId(info.prefix);
        const pid = await terminal.processId;
        terminals.register(terminal, id, agentConfig, pid, context);
      }
    }

    const cleaned = sanitizeLabel(input.trim());
    await terminals.setLabel(terminal, cleaned || undefined, context);

    // Update status bar only (don't rename terminal tab)
    updateStatusBarForTerminal(terminal, context.extensionPath);

    // Optionally update tab title when labels are shown in titles
    const display = getDisplayPrefs(context);
    if (display.showLabelsInTitles && info.prefix) {
      const updatedEntry = terminals.getByTerminal(terminal);
      const newTitle = buildTerminalTitle(
        info.prefix,
        cleaned || undefined,
        context,
        updatedEntry?.sessionId || null
      );
      await terminals.renameTerminal(terminal, newTitle);
    }

    // Mirror the label into Claude via /rename when applicable.
    // Only fire when we have a non-empty label and the agent is Claude.
    if (cleaned && info.prefix === CLAUDE_TITLE) {
      terminal.sendText(`/rename ${cleaned}`, true);
    }
  });
}

async function clearActiveTerminal(context: vscode.ExtensionContext) {
  try {
    const terminal = vscode.window.activeTerminal;
    if (!terminal) {
      vscode.window.showErrorMessage('No active terminal to clear.');
      return;
    }

    const agentConfig = getAgentConfigFromTerminal(terminal, context);
    if (!agentConfig) {
      vscode.window.showErrorMessage('Could not identify agent type from active terminal.');
      return;
    }

    // Get agent type info for session handling
    const builtInDef = getBuiltInDefByTitle(agentConfig.title);
    const agentKey = builtInDef?.key as keyof AgentSettings['builtIn'] | undefined;

    // 1. Terminate current agent (Ctrl+C twice)
    terminal.show();
    await vscode.commands.executeCommand('workbench.action.terminal.sendSequence', {
      text: '\u0003'
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    await vscode.commands.executeCommand('workbench.action.terminal.sendSequence', {
      text: '\u0003'
    });

    // Wait for the agent to release the pty and the shell prompt to reappear
    readiness.resetAfterAgentExit(terminal);
    try {
      await readiness.waitFor(terminal, 'promptReady');
    } catch (err) {
      console.warn(`[READINESS] promptReady wait after agent exit failed: ${err}`);
    }

    try {
      // 2. Generate new IDs for fresh session
      const newTerminalId = terminals.nextId(agentConfig.prefix);
      let newSessionId: string | null = null;
      let command = agentConfig.command || '';
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

      if (agentKey && supportsPrewarming(agentKey)) {
        if (agentKey === 'claude') {
          // Claude: generate UUID on-demand
          newSessionId = generateClaudeSessionId();
          command = buildClaudeOpenCommand(newSessionId);
        } else if (needsPrewarming(agentKey)) {
          // Codex/Gemini: acquire from prewarmed pool
          const prewarmedSession = prewarm.acquireSession(context, agentKey, cwd);
          if (prewarmedSession) {
            newSessionId = prewarmedSession.sessionId;
            command = buildResumeCommand(prewarmedSession);
          }
        }
      }

      // 3. Unregister old entry, re-register with new IDs
      terminals.unregister(terminal);
      const pid = await terminal.processId;
      terminals.register(terminal, newTerminalId, agentConfig, pid, context);

      // 4. Set new session/agent type
      if (newSessionId && agentKey && supportsPrewarming(agentKey)) {
        terminals.setSessionId(terminal, newSessionId);
        terminals.setAgentType(terminal, agentKey);
        await prewarm.recordTerminalSession(context, newTerminalId, newSessionId, agentKey, cwd);
      }

      // 5. Clear labels and start fresh poller
      await terminals.setLabel(terminal, undefined, context);
      terminals.setAutoLabel(terminal, undefined);
      startAutoLabelPollerForTerminal(terminal, context);

      // 6. Unpin terminal
      await vscode.commands.executeCommand('workbench.action.unpinEditor');

      // 7. Update title with new session ID chunk
      const newTitle = buildTerminalTitle(agentConfig.title, null, context, newSessionId);
      await terminals.renameTerminal(terminal, newTitle);

      // 8. Restart agent with new session
      terminal.sendText('clear && ' + command);
      readiness.armAgentReady(terminal, agentKey && newSessionId
        ? { agentKey, sessionId: newSessionId, cwd }
        : {});

      // 9. Update status bar
      updateStatusBarForTerminal(terminal, context.extensionPath);

      const agentNum = newTerminalId.split('-').pop() || '';
      const numSuffix = agentNum ? ` agent # ${agentNum}` : ' agent';
      vscode.window.showInformationMessage(`Cleared ${getExpandedAgentName(agentConfig.title)}${numSuffix} (new session)`);
    } catch (sendError) {
      vscode.window.showWarningMessage('Terminal may have been closed. Please open a new agent terminal.');
    }
  } catch (error) {
    console.error('Error clearing terminal:', error);
    vscode.window.showErrorMessage(`Failed to clear terminal: ${error}`);
  }
}

async function reloadActiveTerminal(context: vscode.ExtensionContext) {
  try {
    const terminal = vscode.window.activeTerminal;
    if (!terminal) {
      vscode.window.showErrorMessage('No active terminal to reload.');
      return;
    }

    const entry = terminals.getByTerminal(terminal);
    if (!entry || !entry.agentConfig) {
      vscode.window.showErrorMessage('Active terminal is not an agent terminal.');
      return;
    }

    const agentConfig = entry.agentConfig;
    const sessionId = entry.sessionId;
    const agentType = entry.agentType;

    if (!sessionId || !agentType) {
      vscode.window.showErrorMessage('This terminal does not have session tracking enabled. Reload requires a session ID.');
      return;
    }

    if (!supportsPrewarming(agentType)) {
      vscode.window.showErrorMessage('This agent type does not support session reload.');
      return;
    }

    const config = PREWARM_CONFIGS[agentType];
    const exitSequence = config.exitSequence;
    const resumeCommand = config.resumeCommand(sessionId);

    terminal.show();
    for (const seq of exitSequence) {
      await vscode.commands.executeCommand('workbench.action.terminal.sendSequence', {
        text: seq
      });
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    readiness.resetAfterAgentExit(terminal);
    try {
      await readiness.waitFor(terminal, 'promptReady');
    } catch (err) {
      console.warn(`[READINESS] promptReady wait after agent exit failed: ${err}`);
    }

    terminal.sendText(`clear && ${resumeCommand}`);
    readiness.armAgentReady(terminal, {
      agentKey: agentType,
      sessionId,
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    });

    updateStatusBarForTerminal(terminal, context.extensionPath);
  } catch (error) {
    console.error('Error reloading terminal:', error);
    vscode.window.showErrorMessage(`Failed to reload terminal: ${error}`);
  }
}

async function updateContextKeys(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('agents');
  const tmuxEnabled = config.get<boolean>('enableTmux', false);
  await vscode.commands.executeCommand('setContext', 'agents.tmuxEnabled', tmuxEnabled);

  const viewEnabled = workbench.isStreamlineLayout();
  await vscode.commands.executeCommand('setContext', 'agents.viewEnabled', viewEnabled);

  const warmingEnabled = prewarm.isEnabled(context);
  await vscode.commands.executeCommand('setContext', 'agents.warmingEnabled', warmingEnabled);
}

async function detectDefaultAgentTitle(): Promise<string> {
  const candidates = [
    { title: CLAUDE_TITLE, key: 'claude' },
    { title: CODEX_TITLE, key: 'codex' },
    { title: GEMINI_TITLE, key: 'gemini' }
  ];

  for (const candidate of candidates) {
    if (await isAgentInstalled(candidate.key)) {
      return candidate.title;
    }
  }

  return CLAUDE_TITLE;
}

async function maybeRunFirstSetup(context: vscode.ExtensionContext, force = false): Promise<void> {
  const already = context.globalState.get<boolean>('agents.setupComplete', false);
  if (already && !force) {
    const stored = context.globalState.get<string>('agents.defaultAgentTitle');
    if (stored) {
      defaultAgentTitle = stored;
    }
    const storedSecondary = context.globalState.get<string>('agents.secondaryAgentTitle');
    if (storedSecondary) {
      secondaryAgentTitle = storedSecondary;
    }
    return;
  }

  // Set default agents on first setup
  defaultAgentTitle = CLAUDE_TITLE;
  secondaryAgentTitle = CODEX_TITLE;
  await context.globalState.update('agents.defaultAgentTitle', CLAUDE_TITLE);
  await context.globalState.update('agents.secondaryAgentTitle', CODEX_TITLE);

  // Ensure swarm MCP + command is enabled for the detected default agent only
  try {
    const def = getBuiltInDefByTitle(defaultAgentTitle);
    const cliAgent = def && ['claude', 'codex', 'gemini'].includes(def.key) ? def.key as swarm.AgentCli : undefined;
    if (cliAgent) {
      const status = await swarm.getSwarmStatus();
      const agentStatus = status.agents[cliAgent];
      if (agentStatus.cliAvailable && (!agentStatus.mcpEnabled || !agentStatus.commandInstalled)) {
        await swarm.setupSwarmIntegrationForAgent(cliAgent, context);
      }
    }
  } catch {
    // Non-fatal; user can rerun setup
  }

  await context.globalState.update('agents.setupComplete', true);
  vscode.window.showInformationMessage(`Agents setup completed. Default agent: ${defaultAgentTitle}.`);
}

// Git functions are now in ./git.vscode

// Store context reference for deactivate
let extensionContext: vscode.ExtensionContext | undefined;

// Restore agent terminals from persisted sessions
// Called after scanExisting() on activation
async function restoreAgentTerminals(context: vscode.ExtensionContext): Promise<void> {
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspacePath) return;

  const persisted = terminals.loadPersistedSessions(workspacePath);
  if (persisted.length === 0) return;

  // Check which persisted sessions are NOT properly tracked
  // (VS Code may have restored them but without our icons/env vars)
  const tracked = terminals.getAllTerminals();
  const trackedIds = new Set(tracked.map(e => e.id));

  const toRestore = persisted.filter(p => !trackedIds.has(p.terminalId));
  if (toRestore.length === 0) {
    terminals.clearPersistedSessions(workspacePath);
    return;
  }

  // Recreate terminals with proper properties
  // Note: With isTransient: true, VS Code won't auto-restore terminals,
  // so we don't need to close "broken" restores - we're the only restore path
  for (const session of toRestore) {
    // Handle shell separately (no built-in def)
    let agentConfig: Omit<import('./agents.vscode').AgentConfig, 'count'>;
    let displayTitle: string;

    if (session.prefix.toLowerCase() === 'sh') {
      agentConfig = createAgentConfig(context.extensionPath, 'SH', '', 'agents.png', 'sh');
      displayTitle = 'SH';
    } else {
      const def = getBuiltInByPrefix(session.prefix);
      if (!def) {
        console.log(`[RESTORE] Unknown prefix: ${session.prefix}, skipping`);
        continue;
      }
      agentConfig = createAgentConfig(context.extensionPath, def.title, def.command, def.icon, def.prefix);
      displayTitle = def.title;
    }

    const title = buildTerminalTitle(displayTitle, session.label, context, session.sessionId || null);

    const terminal = vscode.window.createTerminal({
      iconPath: agentConfig.iconPath,
      location: { viewColumn: vscode.ViewColumn.Active },
      name: title,
      env: buildAgentTerminalEnv(session.terminalId, session.sessionId || null, workspacePath, session.version),
      isTransient: true
    });

    const pid = await terminal.processId;
    terminals.register(terminal, session.terminalId, agentConfig, pid, context, session.label);
    readiness.registerTerminal(terminal);

    // Preserve the version pin across reloads. The env var above is belt; this
    // is suspenders — without it, `resumeCurrentInBestProfile`'s "already on
    // usable version" short-circuit sees `terminalEntry.version === undefined`
    // and falls through to the full profile switch.
    if (session.version) {
      terminals.setVersion(terminal, session.version);
    }

    // Restore session tracking metadata if present
    if (session.sessionId && session.agentType) {
      terminals.setSessionId(terminal, session.sessionId);
      terminals.setAgentType(terminal, session.agentType as SessionAgentType);
      startAutoLabelPollerForTerminal(terminal, context);

      // Actually resume the session by sending the resume command
      if (supportsPrewarming(session.agentType)) {
        const resumeCmd = PREWARM_CONFIGS[session.agentType].resumeCommand(session.sessionId);
        try {
          await readiness.waitFor(terminal, 'promptReady');
        } catch (err) {
          console.warn(`[READINESS] promptReady wait failed: ${err}`);
        }
        if (terminal.shellIntegration) {
          terminal.shellIntegration.executeCommand(resumeCmd);
        } else {
          terminal.sendText(resumeCmd);
        }
        readiness.armAgentReady(terminal, {
          agentKey: session.agentType,
          sessionId: session.sessionId,
          cwd: workspacePath,
        });
      }
    }
  }

  terminals.clearPersistedSessions(workspacePath);
  console.log(`[RESTORE] Restored ${toRestore.length} agent terminal(s)`);
}

async function reopenLastClosedSession(context: vscode.ExtensionContext): Promise<void> {
  const closed = terminals.popClosedSession();
  if (!closed) {
    vscode.window.showInformationMessage('No recently closed sessions to reopen.');
    return;
  }

  if (!closed.agentConfig || !closed.sessionId) {
    vscode.window.showInformationMessage('Last closed session has no resumable session.');
    return;
  }

  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  const title = buildTerminalTitle(
    closed.agentConfig.title,
    closed.label,
    context,
    closed.sessionId
  );

  const terminalId = terminals.nextId(closed.prefix);
  const terminal = vscode.window.createTerminal({
    iconPath: closed.agentConfig.iconPath,
    location: { viewColumn: vscode.ViewColumn.Active },
    name: title,
    env: buildAgentTerminalEnv(terminalId, closed.sessionId, workspacePath),
    isTransient: true
  });

  const pid = await terminal.processId;
  terminals.register(terminal, terminalId, closed.agentConfig, pid, context, closed.label);
  readiness.registerTerminal(terminal);

  if (closed.sessionId && closed.agentType) {
    terminals.setSessionId(terminal, closed.sessionId);
    terminals.setAgentType(terminal, closed.agentType);
    startAutoLabelPollerForTerminal(terminal, context);

    if (supportsPrewarming(closed.agentType)) {
      const resumeCmd = PREWARM_CONFIGS[closed.agentType].resumeCommand(closed.sessionId);
      try {
        await readiness.waitFor(terminal, 'promptReady');
      } catch (err) {
        console.warn(`[READINESS] promptReady wait failed: ${err}`);
      }
      if (terminal.shellIntegration) {
        terminal.shellIntegration.executeCommand(resumeCmd);
      } else {
        terminal.sendText(resumeCmd);
      }
      readiness.armAgentReady(terminal, {
        agentKey: closed.agentType,
        sessionId: closed.sessionId,
        cwd: workspacePath,
      });
    }
  }

  terminal.show();
  console.log(`[REOPEN] Reopened session: ${closed.sessionId} (${closed.agentType})`);
}

function initForemanRegistry(context: vscode.ExtensionContext): void {
  // Lazy import to avoid loading the registry before activate() fires.
  const registry = require('./foreman.registry') as typeof import('./foreman.registry');
  let timer: NodeJS.Timeout | undefined;
  const publish = async () => {
    try {
      const snap = await registry.snapshotOwnTerminals();
      registry.publishLiveTerminals(snap);
    } catch { /* best effort */ }
  };
  context.subscriptions.push(
    vscode.window.onDidOpenTerminal(() => { void publish(); }),
    vscode.window.onDidCloseTerminal(() => { void publish(); }),
    vscode.window.onDidChangeTerminalState(() => { void publish(); }),
  );
  timer = setInterval(publish, 15_000);
  context.subscriptions.push({ dispose: () => { if (timer) clearInterval(timer); } });
  void publish();
}

export async function deactivate(): Promise<void> {
  // Mark clean shutdown for prewarm crash recovery
  if (extensionContext) {
    await prewarm.markCleanShutdown(extensionContext);

    // Persist open agent terminals for restore on next launch (immediate, not debounced)
    terminals.persistNow();
  }

  // Clear internal tracking (don't dispose terminals - let VS Code handle them)
  terminals.clear();
}
