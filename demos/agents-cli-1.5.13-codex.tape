# agents-cli Codex Demo - Clean real workflow
# Run: vhs agents-cli-1.5.13-codex.tape

Output agents-cli-1.5.13-codex.gif

Set Shell "bash"
Set FontSize 18
Set Width 900
Set Height 550
Set Theme "Catppuccin Mocha"
Set Padding 24
Set TypingSpeed 35ms

# Show empty prompts folder
Type "ls ~/.codex/prompts/ 2>/dev/null || echo 'No prompts yet'"
Enter
Sleep 2s

# Add repo
Ctrl+L
Type "agents repo add gh:muqsitnawaz/.agents"
Enter
Sleep 2.5s

# Pull for codex
Type "agents pull codex -y"
Enter
Sleep 4s

# Show the result
Ctrl+L
Type "ls ~/.codex/prompts/"
Enter
Sleep 3s

# Done
Ctrl+L
Type "codex /ship"
Enter
Sleep 2s
