import * as vscode from 'vscode';

/**
 * Update multiple VS Code settings at once.
 * Keys use dot notation (e.g., 'workbench.sideBar.location').
 */
export async function updateSettings(
  settings: Record<string, unknown>,
  target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global
): Promise<void> {
  for (const [key, value] of Object.entries(settings)) {
    // Split key into section and property (e.g., 'workbench.sideBar.location' -> 'workbench', 'sideBar.location')
    const firstDot = key.indexOf('.');
    if (firstDot === -1) {
      throw new Error(`Invalid setting key: ${key}. Must include section (e.g., 'workbench.sideBar.location')`);
    }
    const section = key.slice(0, firstDot);
    const property = key.slice(firstDot + 1);

    const config = vscode.workspace.getConfiguration(section);
    await config.update(property, value, target);
  }
}

/**
 * Read a VS Code setting value.
 */
export function getSetting<T>(key: string): T | undefined {
  const firstDot = key.indexOf('.');
  if (firstDot === -1) {
    throw new Error(`Invalid setting key: ${key}. Must include section (e.g., 'workbench.sideBar.location')`);
  }
  const section = key.slice(0, firstDot);
  const property = key.slice(firstDot + 1);

  const config = vscode.workspace.getConfiguration(section);
  return config.get<T>(property);
}

/**
 * Streamline layout: sidebar right, activity bar hidden.
 */
export async function enableStreamlineLayout(): Promise<void> {
  await updateSettings({
    'workbench.sideBar.location': 'right',
    'workbench.activityBar.visible': false
  });
}

/**
 * Normal layout: sidebar left, activity bar visible.
 */
export async function disableStreamlineLayout(): Promise<void> {
  await updateSettings({
    'workbench.sideBar.location': 'left',
    'workbench.activityBar.visible': true
  });
}

/**
 * Check if streamline layout is currently active.
 */
export function isStreamlineLayout(): boolean {
  const sidebarLocation = getSetting<string>('workbench.sideBar.location');
  const activityBarVisible = getSetting<boolean>('workbench.activityBar.visible');
  return sidebarLocation === 'right' && activityBarVisible === false;
}

/**
 * Toggle streamline layout on/off.
 */
export async function toggleStreamlineLayout(): Promise<boolean> {
  const streamlined = isStreamlineLayout();
  if (streamlined) {
    await disableStreamlineLayout();
    return false;
  } else {
    await enableStreamlineLayout();
    return true;
  }
}
