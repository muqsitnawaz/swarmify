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

// Full agent settings structure
export interface AgentSettings {
  builtIn: {
    claude: BuiltInAgentConfig;
    codex: BuiltInAgentConfig;
    gemini: BuiltInAgentConfig;
    cursor: BuiltInAgentConfig;
    shell: BuiltInAgentConfig;
  };
  custom: CustomAgentConfig[];
}

// Default settings (pure function)
export function getDefaultSettings(): AgentSettings {
  return {
    builtIn: {
      claude: { login: false, instances: 2 },
      codex: { login: false, instances: 2 },
      gemini: { login: false, instances: 2 },
      cursor: { login: false, instances: 2 },
      shell: { login: false, instances: 1 }
    },
    custom: []
  };
}

// Check if any agents have login enabled (pure function)
export function hasLoginEnabled(settings: AgentSettings): boolean {
  return (
    Object.values(settings.builtIn).some(a => a.login) ||
    settings.custom.some(a => a.login)
  );
}
