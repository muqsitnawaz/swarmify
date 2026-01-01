#!/usr/bin/env node
import { runServer } from './server.js';

process.on('SIGTERM', () => {
  console.error('MCP server received SIGTERM');
  process.exit(128 + 15);
});

process.on('SIGINT', () => {
  console.error('MCP server received SIGINT');
  process.exit(128 + 2);
});

process.on('SIGPIPE', () => {
});

process.on('exit', () => {
  console.error('MCP server exiting');
});

runServer().catch((err) => {
  console.error('Fatal error in agent-swarm:', err);
  process.exit(1);
});
