// Settings types and pure functions (no VS Code dependencies - testable)

// Per-agent configuration for built-in agents
export interface BuiltInAgentConfig {
  login: boolean;
  instances: number;
}

// Custom agent configuration
export interface CustomAgentConfig {
  name: string;
  command: string;
  login: boolean;
  instances: number;
}

// Swarm agent types (subset of built-in agents that support swarm)
export type SwarmAgentType = 'cursor' | 'codex' | 'claude' | 'gemini' | 'opencode';
export const ALL_SWARM_AGENTS: SwarmAgentType[] = ['cursor', 'codex', 'claude', 'gemini', 'opencode'];

// Full agent settings structure
export interface AgentSettings {
  builtIn: {
    claude: BuiltInAgentConfig;
    codex: BuiltInAgentConfig;
    gemini: BuiltInAgentConfig;
    opencode: BuiltInAgentConfig;
    cursor: BuiltInAgentConfig;
    shell: BuiltInAgentConfig;
  };
  custom: CustomAgentConfig[];
  swarmEnabledAgents: SwarmAgentType[];
}

// Default settings (pure function)
export function getDefaultSettings(): AgentSettings {
  return {
    builtIn: {
      claude: { login: false, instances: 2 },
      codex: { login: false, instances: 2 },
      gemini: { login: false, instances: 2 },
      opencode: { login: false, instances: 2 },
      cursor: { login: false, instances: 2 },
      shell: { login: false, instances: 1 }
    },
    custom: [],
    swarmEnabledAgents: [...ALL_SWARM_AGENTS]
  };
}

// Check if any agents have login enabled (pure function)
export function hasLoginEnabled(settings: AgentSettings): boolean {
  return (
    Object.values(settings.builtIn).some(a => a.login) ||
    settings.custom.some(a => a.login)
  );
}
