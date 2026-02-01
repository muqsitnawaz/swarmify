# agents-cli Demo
# Run: vhs agents-cli-1.5.13.tape

Output agents-cli-1.5.13.gif

Set Shell "bash"
Set FontSize 14
Set Width 1200
Set Height 700
Set Theme "Catppuccin Mocha"
Set Padding 20
Set TypingSpeed 50ms

# Title
Type "echo '=== agents-cli: Sync /commands & MCP servers across AI agents ==='"
Enter
Sleep 1.5s
Ctrl+L

# ============================================
# Scene 1: Show the problem
# ============================================
Type "echo 'Problem: You have custom /commands on one machine...'"
Enter
Sleep 1s
Type "ls ~/.claude/commands/"
Enter
Sleep 2s
Ctrl+L

# ============================================
# Scene 2: Connect to your .agents repo
# ============================================
Type "echo 'Solution: Store them in a GitHub repo and sync'"
Enter
Sleep 1s

Type "agents repo add gh:muqsitnawaz/.agents"
Enter
Sleep 2.5s

# ============================================
# Scene 3: Pull commands
# ============================================
Type "echo 'Pull commands to all your AI agents'"
Enter
Sleep 1s

Type "agents pull -y"
Enter
Sleep 4s

# ============================================
# Scene 4: Show status
# ============================================
Ctrl+L
Type "echo 'Check what is installed across all agents'"
Enter
Sleep 1s

Type "agents status"
Enter
Sleep 3.5s

# ============================================
# Scene 5: Show MCP sync
# ============================================
Ctrl+L
Type "echo 'MCP servers sync too!'"
Enter
Sleep 1s

Type "echo 'Push your config back to the repo'"
Enter
Sleep 1s
Type "agents push"
Enter
Sleep 3s

# ============================================
# Scene 6: New machine setup
# ============================================
Ctrl+L
Type "echo 'On a new machine? One command:'"
Enter
Sleep 1s

Type "agents pull gh:muqsitnawaz/.agents -y"
Enter
Sleep 3s

Type "echo 'All your commands, MCP servers, and hooks are ready!'"
Enter
Sleep 2s

# ============================================
# Finale
# ============================================
Ctrl+L
Type "echo 'Install: npm i -g @swarmify/agents-cli'"
Enter
Type "echo 'Docs: https://swarmify.co/agents-cli'"
Enter
Sleep 3s
