# agents-cli Feature Demo
# Run: vhs agents-cli-1.5.13-features.tape

Output agents-cli-1.5.13-features.gif

Set Shell "bash"
Set FontSize 15
Set Width 1100
Set Height 650
Set Theme "Catppuccin Mocha"
Set Padding 20
Set TypingSpeed 45ms

# ============================================
# Intro
# ============================================
Type "echo '=== agents-cli: One repo, all your AI agents ==='"
Enter
Type "echo 'Supported: Claude Code, Codex, Gemini CLI, Cursor'"
Enter
Sleep 2s
Ctrl+L

# ============================================
# Feature 1: Pull commands
# ============================================
Type "echo '1. Sync slash commands from GitHub'"
Enter
Sleep 0.8s
Type "agents pull claude"
Enter
Sleep 3.5s

# ============================================
# Feature 2: Multi-agent sync
# ============================================
Ctrl+L
Type "echo '2. Same commands work across all agents'"
Enter
Sleep 0.8s
Type "agents pull codex gemini -y"
Enter
Sleep 3s

# ============================================
# Feature 3: Status view
# ============================================
Ctrl+L
Type "echo '3. See everything in one view'"
Enter
Sleep 0.8s
Type "agents status"
Enter
Sleep 4s

# ============================================
# Feature 4: MCP servers
# ============================================
Ctrl+L
Type "echo '4. Sync MCP servers too'"
Enter
Sleep 0.8s
Type "agents mcp list"
Enter
Sleep 2s
Type "agents push"
Enter
Sleep 2.5s

# ============================================
# Feature 5: Hooks
# ============================================
Ctrl+L
Type "echo '5. Hooks sync automatically'"
Enter
Sleep 0.8s
Type "agents hooks list"
Enter
Sleep 2.5s

# ============================================
# End
# ============================================
Ctrl+L
Type "echo 'Your .agents repo structure:'"
Enter
Type "echo '  claude/commands/*.md'"
Enter
Type "echo '  codex/prompts/*.md'"
Enter
Type "echo '  gemini/commands/*.toml'"
Enter
Type "echo '  agents.yaml (CLI versions, MCP servers)'"
Enter
Sleep 2s

Type "echo ''"
Enter
Type "echo 'Get started: npm i -g @swarmify/agents-cli'"
Enter
Sleep 2.5s
