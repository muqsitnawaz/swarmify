# agents CLI Promo Video

Promotional video for the agents CLI tool - a unified package manager for AI coding agents.

## Overview

This video showcases the agents CLI's developer-friendly, git-like interface for managing commands, MCP servers, hooks, and CLI versions across Claude, Codex, Gemini, and other AI agents.

## Video Structure

- **Hook** (0-180 frames): Introduces agents CLI with key commands
- **Problem** (165-330 frames): Shows pain points of manual agent management
- **Solution** (315-510 frames): Git-like commands (status, pull, push)
- **Scope** (495-720 frames): User vs project scope diagram
- **Features** (705-900 frames): Key features (Commands, MCP, Auto-conversion, Version pinning)
- **Demo** (885-1080 frames): Quick workflow demonstration
- **CTA** (1065-1200 frames): Install instructions and GitHub link

## Development

```bash
cd agents-cli/promo
npm install
npm run start      # Open Remotion Studio
npm run preview   # Preview video
npm run build     # Render to out/video.mp4
```

## Design System

- **Background**: Dark gradient (`#05050a` → `#0d0d15`)
- **Accents**: Cyan, purple, blue, pink glow effects
- **Terminal**: Mac-style window with red/yellow/green dots
- **Typography**: Inter/Monospace for terminal text
- **Animations**: Spring physics (damping: 200), typewriter effects (22 chars/sec)

## Components

- `Background` - Animated gradient with ambient glow
- `GlowText` - Text with glow pulse effect
- `TypeWriter` - Terminal-style typing animation
- `TerminalWindow` - Mac-styled terminal container
- `CommandDisplay` - Syntax-highlighted terminal output
- `SyncAnimation` - Push/pull visualization
- `ScopeDiagram` - User vs project scope visualization
- `FeatureCard` - Feature grid cards with icons

## Duration

- **Total**: 1200 frames (40 seconds at 30 fps)
- **Resolution**: 1920x1080 (Full HD)
- **Codec**: H.264
