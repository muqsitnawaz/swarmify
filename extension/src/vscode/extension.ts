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
import * as notifications from './notifications.vscode';
import * as terminals from './terminals.vscode';
import { buildAgentTerminalEnv } from '../core/terminals';
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
  formatRelativeTime,
  truncateText,
  extractFirstNWords,
  TerminalIdentificationOptions
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
import { supportsPrewarming, buildResumeCommand, PREWARM_CONFIGS } from '../core/prewarm';
import { needsPrewarming, generateClaudeSessionId, buildClaudeOpenCommand } from '../core/prewarm.simple';
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

/**
 * Wait for a terminal's shell to be ready to accept input.
 * Uses VS Code's shell integration API which fires when the shell finishes loading (after .zshrc etc).
 * Falls back to sendText if shell integration doesn't activate within the timeout.
 *
 * @param terminal The terminal to wait for
 * @param timeoutMs Maximum time to wait (default 5000ms)
 * @returns true if shell integration is available, false if timed out
 */
async function waitForShellReady(terminal: vscode.Terminal, timeoutMs: number = 5000): Promise<boolean> {
  // Check if shell integration is already available
  if (terminal.shellIntegration) {
    return true;
  }

  return new Promise((resolve) => {
    let resolved = false;

    const listener = vscode.window.onDidChangeTerminalShellIntegration(({ terminal: t }) => {
      if (t === terminal && !resolved) {
        resolved = true;
        listener.dispose();
        resolve(true);
      }
    });

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        listener.dispose();
        resolve(false); // Timed out, fall back to sendText
      }
    }, timeoutMs);
  });
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
  terminals.scanExisting((name, knownPrefix) => inferAgentConfigFromName(name, context.extensionPath, knownPrefix), context)
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

      if (identOpts.sessionId) {
        terminals.setSessionId(terminal, identOpts.sessionId);
      }
    })
  );

  registerTmuxCleanup(context);

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

  // Register URI handler for notification callbacks and OAuth
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      async handleUri(uri: vscode.Uri) {
        const params = new URLSearchParams(uri.query);

        if (uri.path === '/focus') {
          // Parse terminalId from query string
          const terminalId = params.get('terminalId');

          const entry = terminalId ? terminals.getById(terminalId) : undefined;
          if (entry) {
            entry.terminal.show();
            console.log(`Focused terminal: ${terminalId}`);
          } else {
            console.warn(`Terminal not found for ID: ${terminalId}`);
          }
        } else if (uri.path === '/oauth/callback') {
          // OAuth callback from GitHub/Linear
          const code = params.get('code');
          const state = params.get('state');

          if (code && state) {
            console.log(`[OAUTH] Received callback for ${state}`);

            // Exchange code for token via backend
            try {
              // Determine client_id based on current IDE
              const uriScheme = vscode.env.uriScheme;
              const githubClientIds: Record<string, string> = {
                'vscode': 'Ov23liKYaRnJ5DqzmPYO',
                'cursor': 'Ov23lil7uKgqBdj9OhX4',
                'vscode-insiders': 'Ov23liKYaRnJ5DqzmPYO',
              };
              const client_id = state === 'github' ? (githubClientIds[uriScheme] || githubClientIds['vscode']) : undefined;

              const response = await fetch('https://swarmify-oauth.muqsitnawaz.workers.dev/oauth/exchange', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, provider: state, client_id })
              });

              if (response.ok) {
                const data = await response.json() as { access_token: string };
                await context.globalState.update(`${state}_mcp_token`, data.access_token);
                vscode.window.showInformationMessage(`${state === 'github' ? 'GitHub' : 'Linear'} connected successfully!`);

                // Notify settings panel if open
                settings.notifyOAuthComplete(state, data.access_token);
              } else {
                throw new Error(`Token exchange failed: ${response.status}`);
              }
            } catch (err) {
              console.error(`[OAUTH] Token exchange error:`, err);
              vscode.window.showErrorMessage(`Failed to connect ${state}. Please try again.`);
            }
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
    vscode.commands.registerCommand('agents.configure', () => settings.openPanel(context))
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
      let agentConfig: Omit<AgentConfig, 'count'> | null = getBuiltInByTitle(context.extensionPath, targetTitle);
      if (agentConfig?.command && !(await commandExists(agentConfig.command))) {
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
    vscode.commands.registerCommand('agents.setupClaude', () => swarm.setupSwarmIntegrationForAgent('claude', context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.setupCodex', () => swarm.setupSwarmIntegrationForAgent('codex', context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.setupGemini', () => swarm.setupSwarmIntegrationForAgent('gemini', context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.setupTrae', () => swarm.setupSwarmIntegrationForAgent('trae', context))
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
    vscode.commands.registerCommand('agents.handoff', () => handoffToAgent(context))
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
      vscode.commands.registerCommand(command, () => {
        if (!slot) return; // Unconfigured = do nothing (silent)

        const builtInDef = getBuiltInByKey(slot.agent);
        if (!builtInDef) return;

        const agentConfig = getBuiltInByTitle(context.extensionPath, builtInDef.title);
        if (agentConfig) {
          // Build flags with model if specified
          const flags = slot.model ? `--model ${slot.model}` : undefined;
          openSingleAgent(context, agentConfig, flags);
        }
      })
    );
  }

  // Listen for terminal closures to update our tracking
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((terminal) => {
      // Remove prewarm session mapping if exists
      const entry = terminals.getByTerminal(terminal);
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
  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs(() => {
      if (!agentStatusBarItem) return;

      // Check if the active tab in the active group is a terminal
      const activeGroup = vscode.window.tabGroups.activeTabGroup;
      const activeTab = activeGroup?.activeTab;

      if (!activeTab || !(activeTab.input instanceof vscode.TabInputTerminal)) {
        // Not a terminal tab - already handled by onDidChangeActiveTextEditor
        return;
      }

      // Find the terminal that matches this tab by name
      const terminalNames = vscode.window.terminals.map(t => t.name);
      const matchedName = findTerminalNameByTabLabel(terminalNames, activeTab.label);
      if (matchedName) {
        const matchedTerminal = vscode.window.terminals.find(t => t.name === matchedName);
        if (matchedTerminal) {
          updateStatusBarForTerminal(matchedTerminal, context.extensionPath);

          // Update terminal titles based on focus state (for showLabelOnlyOnFocus feature)
          updateTerminalTitleOnFocus(matchedTerminal, context);
        }
      }
    })
  );

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

  if (agentKey && supportsPrewarming(agentKey) && !additionalFlags) {
    if (agentKey === 'claude') {
      // Claude: Generate session ID at open time, no prewarming needed
      sessionId = generateClaudeSessionId();
      command = buildClaudeOpenCommand(sessionId);
      usePrewarmed = true; // For tracking purposes
      console.log(`[PREWARM] Claude using on-demand session ID: ${sessionId}`);
    } else if (needsPrewarming(agentKey)) {
      // Codex/Gemini: Use prewarmed session from pool
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

    // Track session ID and agent type for all terminals (not just prewarmed)
    if (sessionId) {
      terminals.setSessionId(terminal, sessionId);
      if (agentKey && supportsPrewarming(agentKey)) {
        terminals.setAgentType(terminal, agentKey);
      }
    }
    // Record prewarmed session separately
    if (usePrewarmed && sessionId && agentKey && supportsPrewarming(agentKey)) {
      await prewarm.recordTerminalSession(context, terminalId, sessionId, agentKey, cwd);
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

  // Track session ID and agent type for all terminals (not just prewarmed)
  if (sessionId) {
    terminals.setSessionId(terminal, sessionId);
    if (agentKey && supportsPrewarming(agentKey)) {
      terminals.setAgentType(terminal, agentKey);
    }
  }
  // Record prewarmed session separately
  if (usePrewarmed && sessionId && agentKey && supportsPrewarming(agentKey)) {
    await prewarm.recordTerminalSession(context, terminalId, sessionId, agentKey, cwd);
  }

  if (command) {
    // Wait for shell to be ready before sending command
    const shellReady = await waitForShellReady(terminal);
    if (shellReady && terminal.shellIntegration) {
      terminal.shellIntegration.executeCommand(command);
    } else {
      // Fallback to sendText if shell integration not available
      terminal.sendText(command);
    }
  }
}

async function newTaskWithContext(context: vscode.ExtensionContext) {
  const agentSettings = settings.getSettings(context);
  const tasks = await tasksImport.fetchAllTasks(context, agentSettings.taskSources);

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
    const sessionPath = await getSessionPathBySessionId(terminalEntry.sessionId, agentType, workspacePath);

    if (sessionPath) {
      messages = await handoff.getSessionMessages(sessionPath, 10);

      if (agentType === 'claude') {
        planInfo = await handoff.findRecentClaudePlan();
      }
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

interface TerminalQuickPickItem extends vscode.QuickPickItem {
  terminal: vscode.Terminal;
}

async function goToTerminal(context: vscode.ExtensionContext) {
  // Use internal registry - each entry has unique ID, no ambiguous matching needed
  const allEntries = terminals.getAllTerminals();
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  // Filter to agent terminals and build quick pick items
  const items: TerminalQuickPickItem[] = [];
  const previewPromises: Array<{ itemIndex: number; promise: Promise<{ firstUserMessage?: string; lastUserMessage?: string; messageCount: number } | null> }> = [];

  for (const entry of allEntries) {
    // Skip non-agent terminals
    if (!entry.agentConfig) continue;

    const expandedName = getExpandedAgentName(entry.agentConfig.prefix);
    const sessionChunk = entry.sessionId ? `[${entry.sessionId.slice(0, 8)}]` : '';
    const timeAgo = formatRelativeTime(entry.createdAt);
    const labelParts = [expandedName, sessionChunk, timeAgo].filter(Boolean);
    const itemIndex = items.length;

    items.push({
      label: labelParts.join(' '),
      description: '',
      terminal: entry.terminal
    });

    // Queue preview fetch if session exists
    if (entry.sessionId && entry.agentType) {
      const agentType = entry.agentType as 'claude' | 'codex' | 'gemini';
      previewPromises.push({
        itemIndex,
        promise: (async () => {
          const sessionPath = await getSessionPathBySessionId(entry.sessionId!, agentType, workspacePath);
          if (!sessionPath) return null;
          return await getSessionPreviewInfo(sessionPath);
        })()
      });
    }
  }

  if (items.length === 0) {
    vscode.window.showInformationMessage('No agent terminals open');
    return;
  }

  // Resolve preview info in parallel
  const previewResults = await Promise.all(previewPromises.map(p => p.promise));
  for (let i = 0; i < previewPromises.length; i++) {
    const info = previewResults[i];
    if (info) {
      const idx = previewPromises[i].itemIndex;
      const parts: string[] = [];
      if (info.firstUserMessage) parts.push(truncateText(info.firstUserMessage, 40));
      if (info.messageCount > 0) parts.push(`(${info.messageCount})`);
      items[idx].description = parts.join(' ');
    }
  }

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Go to terminal',
    matchOnDescription: true
  });

  if (selected) {
    selected.terminal.show();
  }
}

async function openSingleAgentWithQueue(
  context: vscode.ExtensionContext,
  agentConfig: Omit<AgentConfig, 'count'>,
  messages: string[]
) {
  const editorLocation: vscode.TerminalEditorLocationOptions = {
    viewColumn: vscode.ViewColumn.Active,
    preserveFocus: false
  };

  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const terminalId = terminals.nextId(agentConfig.prefix);
  const title = buildTerminalTitle(agentConfig.title, undefined, context, null);
  const terminal = vscode.window.createTerminal({
    iconPath: agentConfig.iconPath,
    location: editorLocation,
    name: title,
    env: buildAgentTerminalEnv(terminalId, null, workspacePath),
    isTransient: true
  });

  const pid = await terminal.processId;
  terminals.register(terminal, terminalId, agentConfig, pid, context);

  // Queue messages
  for (const msg of messages) {
    terminals.queueMessage(terminal, msg);
  }

  // Send agent command
  if (agentConfig.command) {
    terminal.sendText(agentConfig.command);
  }

  // After delay, send queued messages (5s to ensure agent process fully loaded)
  setTimeout(() => {
    const queued = terminals.flushQueue(terminal);
    for (const msg of queued) {
      terminal.sendText(msg);
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

      // Track session ID
      if (sessionId && agentKey && supportsPrewarming(agentKey)) {
        terminals.setSessionId(terminal, sessionId);
        terminals.setAgentType(terminal, agentKey);
        await prewarm.recordTerminalSession(context, terminalId, sessionId, agentKey, cwd);
      }

      if (command) {
        // Wait for shell to be ready before sending command
        const shellReady = await waitForShellReady(terminal);
        if (shellReady && terminal.shellIntegration) {
          terminal.shellIntegration.executeCommand(command);
        } else {
          // Fallback to sendText if shell integration not available
          terminal.sendText(command);
        }
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

  const agentType = entry.agentType;
  if (!agentType || !['claude', 'codex', 'gemini', 'opencode', 'cursor'].includes(agentType)) return undefined;

  try {
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const sessionPath = await getSessionPathBySessionId(
      entry.sessionId,
      agentType as 'claude' | 'codex' | 'gemini' | 'opencode' | 'cursor',
      workspacePath
    );
    if (!sessionPath) return undefined;

    // Each agent has different storage structure
    let previewInfo;
    if (agentType === 'opencode') {
      previewInfo = await getOpenCodeSessionPreviewInfo(sessionPath);
    } else if (agentType === 'cursor') {
      previewInfo = getCursorSessionPreviewInfo(sessionPath);
    } else {
      previewInfo = await getSessionPreviewInfo(sessionPath);
    }

    if (!previewInfo.firstUserMessage) return undefined;

    const autoLabel = extractFirstNWords(previewInfo.firstUserMessage, 5);
    if (autoLabel) {
      terminals.setAutoLabel(terminal, autoLabel);
    }
    return autoLabel ?? undefined;
  } catch {
    return undefined;
  }
}

function updateStatusBarForTerminal(terminal: vscode.Terminal, extensionPath: string) {
  if (!agentStatusBarItem) return;

  const entry = terminals.getByTerminal(terminal);
  const info = identifyAgentTerminal(terminal, extensionPath);

  // If this is an agent terminal, show its name
  // Format: "Agents: Claude - <Label> (uuid-chunk)"
  if (info.isAgent && info.prefix) {
    const expandedName = getExpandedAgentName(info.prefix);
    const sessionChunk = getSessionChunk(entry?.sessionId);

    // Show immediate status bar with current data
    const displayLabel = entry?.label || entry?.autoLabel;
    let text = `Agents: ${expandedName}`;
    if (displayLabel) {
      text += ` - ${displayLabel}`;
    }
    if (sessionChunk) {
      text += ` (${sessionChunk})`;
    }
    agentStatusBarItem.text = text;

    // If no label/autoLabel but we have sessionId, fetch auto-label async
    if (!displayLabel && entry?.sessionId && entry.agentType) {
      fetchAndSetAutoLabel(terminal, entry).then(autoLabel => {
        if (autoLabel && agentStatusBarItem && vscode.window.activeTerminal === terminal) {
          // Re-render status bar with auto-label
          let updatedText = `Agents: ${expandedName}`;
          updatedText += ` - ${autoLabel}`;
          if (sessionChunk) {
            updatedText += ` (${sessionChunk})`;
          }
          agentStatusBarItem.text = updatedText;
        }
      });
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
    await new Promise(resolve => setTimeout(resolve, 200));
    await vscode.commands.executeCommand('workbench.action.terminal.sendSequence', {
      text: '\u0003'
    });

    // Wait for process to terminate
    await new Promise(resolve => setTimeout(resolve, 1500));

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

      // 5. Clear labels
      await terminals.setLabel(terminal, undefined, context);
      terminals.setAutoLabel(terminal, undefined);

      // 6. Unpin terminal
      await vscode.commands.executeCommand('workbench.action.unpinEditor');

      // 7. Update title with new session ID chunk
      const newTitle = buildTerminalTitle(agentConfig.title, null, context, newSessionId);
      await terminals.renameTerminal(terminal, newTitle);

      // 8. Restart agent with new session
      terminal.sendText('clear && ' + command);

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
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    await new Promise(resolve => setTimeout(resolve, 1500));

    terminal.sendText(`clear && ${resumeCommand}`);

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

function commandExists(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const whichCmd = process.platform === 'win32' ? 'where' : 'which';
    const child = require('child_process').exec(`${whichCmd} ${cmd}`, (err: Error | null) => {
      resolve(!err);
    });
    if (!child) resolve(false);
  });
}

async function detectDefaultAgentTitle(): Promise<string> {
  const candidates = [
    { title: CLAUDE_TITLE, command: 'claude' },
    { title: CODEX_TITLE, command: 'codex' },
    { title: GEMINI_TITLE, command: 'gemini' }
  ];

  for (const candidate of candidates) {
    if (await commandExists(candidate.command)) {
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
      env: buildAgentTerminalEnv(session.terminalId, session.sessionId || null, workspacePath),
      isTransient: true
    });

    const pid = await terminal.processId;
    terminals.register(terminal, session.terminalId, agentConfig, pid, context, session.label);

    // Restore session tracking metadata if present
    if (session.sessionId && session.agentType) {
      terminals.setSessionId(terminal, session.sessionId);
      terminals.setAgentType(terminal, session.agentType as terminals.SessionAgentType);

      // Actually resume the session by sending the resume command
      if (supportsPrewarming(session.agentType)) {
        const resumeCmd = PREWARM_CONFIGS[session.agentType].resumeCommand(session.sessionId);
        // Wait for shell to be ready before sending resume command
        const shellReady = await waitForShellReady(terminal);
        if (shellReady && terminal.shellIntegration) {
          terminal.shellIntegration.executeCommand(resumeCmd);
        } else {
          // Fallback to sendText if shell integration not available
          terminal.sendText(resumeCmd);
        }
      }
    }
  }

  terminals.clearPersistedSessions(workspacePath);
  console.log(`[RESTORE] Restored ${toRestore.length} agent terminal(s)`);
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
