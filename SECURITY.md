# Swarmify Security Standards

This document outlines the security posture and permission standards for agents operating within the Swarmify environment.

## Core Security Philosophy: Fail-Open to Prompt

Swarmify agents operate under a "Fail-Open to Prompt" model.
- **Auto-Approved**: Common read-only inspection tools (e.g., `ls`, `git status`, `docker ps`).
- **Gated**: Any operation that modifies the filesystem, network state, or cloud infrastructure requires explicit user confirmation.

## Hardened Resource Types

The following resource types are strictly constrained by default to prevent accidental data loss or exposure.

### 1. Cloud Provider CLIs
Agents are permitted to perform **read-only inspection** only. Broad wildcards (e.g., `aws:*`) are forbidden. 
- **Allowed**: `aws s3 ls`, `gcloud config list`, `supabase status`.
- **Denied**: `aws s3 rm`, `gcloud compute instances delete`, `supabase db push`.

### 2. Docker & Runtimes
Agents can inspect the state of containers but cannot manipulate them without oversight.
- **Allowed**: `docker ps`, `docker logs`, `docker inspect`.
- **Denied**: `docker run`, `docker stop`, `docker-compose up`.

### 3. Sensitive Credentials
Access to the following directories is **explicitly denied** in all modes:
- `~/.ssh/`
- `~/.aws/credentials`
- `~/.kube/config`
- `~/.config/gcloud/`

## Swarm Orchestration Guardrails

The Swarmify MCP server (`agents-mcp`) enforces additional guardrails:
- **Deprecated Modes**: Spawning with `mode: 'ralph'` is blocked.
- **Permission Bypass**: Attempts to spawn with `bypassPermissions` should be flagged.
- **Environment Scrubbing**: Sensitive host environment variables are scrubbed before being passed to subagents.

## Implementation Guidelines

When adding new "Skills" or tools to Swarmify:
1. **Prefer Read-Only**: Design tools to be read-only by default.
2. **Use Native Proxies**: Instead of granting raw shell access to sensitive tools, create a wrapper skill that performs validation.
3. **No Backgrounding**: Avoid `run_in_background: true` as it bypasses visibility into agent activity.
