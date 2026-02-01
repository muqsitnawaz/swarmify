# agents-cli Short Demo (30 seconds)
# Run: vhs agents-cli-1.5.13-short.tape

Output agents-cli-1.5.13-short.gif

Set Shell "bash"
Set FontSize 16
Set Width 900
Set Height 500
Set Theme "Catppuccin Mocha"
Set Padding 20
Set TypingSpeed 40ms

# Hook
Type "echo 'Sync /commands across Claude, Codex & Gemini'"
Enter
Sleep 1.2s
Ctrl+L

# Pull
Type "agents pull gh:your-username/.agents -y"
Enter
Sleep 3s

# Status
Ctrl+L
Type "agents status claude"
Enter
Sleep 2.5s

# Push
Ctrl+L
Type "echo 'Added MCP servers? Push them back'"
Enter
Sleep 0.8s
Type "agents push"
Enter
Sleep 2.5s

# CTA
Ctrl+L
Type "echo 'npm i -g @swarmify/agents-cli'"
Enter
Sleep 2s
