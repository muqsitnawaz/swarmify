import React from 'react';
import {AbsoluteFill, useCurrentFrame, interpolate, useVideoConfig} from 'remotion';
import {colors} from './styles/colors';
import {GlowText} from './components/GlowText';
import {TypeWriter} from './components/TypeWriter';
import {Background} from './components/Background';
import {TerminalWindow} from './components/TerminalWindow';
import {CommandDisplay, OutputLine} from './components/CommandDisplay';
import {SyncAnimation} from './components/SyncAnimation';
import {ScopeDiagram} from './components/ScopeDiagram';
import {FeatureCard} from './components/FeatureCard';

interface SceneProps {
  start: number;
}

const HookScene: React.FC<SceneProps> = ({start}) => {
  const frame = useCurrentFrame() - start;
  const subOpacity = interpolate(frame, [40, 80], [0, 1], {extrapolateRight: 'clamp'});
  const commandsOpacity = interpolate(frame, [70, 110], [0, 1], {extrapolateRight: 'clamp'});
  const taglineOpacity = interpolate(frame, [100, 140], [0, 1], {extrapolateRight: 'clamp'});

  const commands = [
    {name: 'status', desc: 'Check sync status'},
    {name: 'push', desc: 'Export to GitHub'},
    {name: 'pull', desc: 'Sync from GitHub'},
  ];

  return (
    <AbsoluteFill style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 80,
      gap: 50,
    }}>
      <GlowText color={colors.glow.cyan} delay={0} size={2.0}>
        agents CLI
      </GlowText>
      <div style={{
        fontSize: 26,
        color: colors.text.primary,
        fontWeight: 600,
        textAlign: 'center',
        opacity: subOpacity,
      }}>
        Your agent configurations, unified
      </div>
      <div style={{
        display: 'flex',
        gap: 24,
        opacity: commandsOpacity,
      }}>
        {commands.map((cmd, idx) => (
          <div key={cmd.name} style={{
            padding: '16px 24px',
            background: `${colors.background.accent}cc`,
            borderRadius: 12,
            border: `1px solid ${colors.glow.cyan}44`,
            boxShadow: `0 0 ${30}px ${colors.glow.cyan}22`,
          }}>
            <div style={{
              fontFamily: 'monospace',
              fontSize: 16,
              color: colors.glow.cyan,
              fontWeight: 700,
              marginBottom: 6,
            }}>
              {cmd.name}
            </div>
            <div style={{
              fontSize: 13,
              color: colors.text.tertiary,
            }}>
              {cmd.desc}
            </div>
          </div>
        ))}
      </div>
      <div style={{
        fontSize: 20,
        color: colors.text.secondary,
        textAlign: 'center',
        opacity: taglineOpacity,
      }}>
        Developer-friendly interface. Git-like commands.
      </div>
    </AbsoluteFill>
  );
};

const ProblemScene: React.FC<SceneProps> = ({start}) => {
  const frame = useCurrentFrame() - start;
  const opacity = interpolate(frame, [20, 50], [0, 1], {extrapolateRight: 'clamp'});
  const painPoints = [
    'Each agent has its own config location',
    'Commands manually added to each agent',
    'Manual conversion (Markdown to TOML)',
    'No easy way to sync across machines',
  ];

  return (
    <AbsoluteFill style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 70,
      gap: 36,
    }}>
      <div style={{
        fontSize: 28,
        color: colors.text.primary,
        fontWeight: 700,
        textAlign: 'center',
        opacity,
      }}>
        Managing multiple AI agents is painful
      </div>

      <div style={{
        padding: '20px 24px',
        background: colors.background.terminal,
        borderRadius: 12,
        border: `1px solid ${colors.background.accent}`,
        fontFamily: 'monospace',
        fontSize: 13,
        color: colors.text.terminal,
        opacity,
        maxWidth: 800,
      }}>
        <div style={{color: colors.terminal.comment, marginBottom: 8}}>
          {'# Manual setup across agents...'}
        </div>
        <div style={{color: colors.text.terminal, marginBottom: 4}}>
          <span style={{color: colors.terminal.command}}>claude</span> mcp add Swarm -- npx @swarmify/agents-mcp
        </div>
        <div style={{color: colors.text.terminal, marginBottom: 4}}>
          <span style={{color: colors.terminal.command}}>codex</span> mcp add swarm -- npx @swarmify/agents-mcp
        </div>
        <div style={{color: colors.text.terminal, marginBottom: 4}}>
          <span style={{color: colors.terminal.command}}>gemini</span> mcp add Swarm -- npx @swarmify/agents-mcp
        </div>
        <div style={{color: colors.terminal.comment, marginTop: 8, marginBottom: 8}}>
          {'# Repeat for every command...'}
        </div>
        <div style={{color: colors.terminal.error}}>
          Manual. Repetitive. Error-prone.
        </div>
      </div>

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        maxWidth: 700,
      }}>
        {painPoints.map((point, idx) => (
          <div key={point} style={{
            padding: '14px 18px',
            background: `${colors.background.accent}88`,
            borderRadius: 10,
            border: `1px solid ${colors.background.accent}`,
            color: colors.text.secondary,
            fontSize: 15,
            opacity: interpolate(frame, [60 + idx * 10, 80 + idx * 10], [0, 1], {extrapolateRight: 'clamp'}),
          }}>
            {point}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const SolutionScene: React.FC<SceneProps> = ({start}) => {
  const frame = useCurrentFrame() - start;

  const steps = [
    {
      title: 'agents status',
      desc: 'See everything at a glance',
      lines: [
        {text: '$ agents status'},
        {text: ''},
        {text: 'Agent CLIs', color: colors.glow.purple},
        {text: '  Claude Code     2.0.65', color: colors.terminal.success},
        {text: '  Codex           1.2.3', color: colors.terminal.success},
        {text: '  Gemini          1.0.0', color: colors.terminal.success},
        {text: ''},
        {text: 'Installed Commands', color: colors.glow.purple},
        {text: '  Claude: 12 user, 3 project', color: colors.text.terminal},
        {text: '  Codex: 12 user, 2 project', color: colors.text.terminal},
        {text: ''},
        {text: 'Sync Source', color: colors.glow.purple},
        {text: '  gh:username/.agents', color: colors.terminal.path},
        {text: '  Last sync: 2 hours ago', color: colors.text.terminal},
      ],
    },
    {
      title: 'agents pull gh:user/.agents',
      desc: 'Clone and sync in one command',
      isPull: true,
    },
    {
      title: 'agents push',
      desc: 'Export and prepare for commit',
      isPush: true,
      lines: [
        {text: '$ agents push'},
        {text: ''},
        {text: '+ Claude Code @ 2.0.65', color: colors.terminal.success},
        {text: '+ Codex @ 1.2.3', color: colors.terminal.success},
        {text: ''},
        {text: 'Next:', color: colors.terminal.comment},
        {text: '  cd ~/.agents/repos/.agents', color: colors.text.terminal},
        {text: '  git add -A', color: colors.terminal.command},
        {text: '  git commit -m "Update config"', color: colors.terminal.command},
        {text: '  git push', color: colors.terminal.command},
      ],
    },
  ];

  const currentStep = Math.floor(frame / 70);

  return (
    <AbsoluteFill style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 80,
      gap: 40,
    }}>
      <GlowText color={colors.text.primary} delay={0} size={1.5}>
        Git-like commands you already know
      </GlowText>

      {currentStep < steps.length ? (
        <>
          <div style={{
            fontSize: 22,
            color: colors.glow.cyan,
            fontFamily: 'monospace',
            marginBottom: 8,
            opacity: interpolate(frame, [0, 20], [0, 1], {extrapolateRight: 'clamp'}),
          }}>
            {steps[currentStep].title}
          </div>
          <div style={{
            fontSize: 18,
            color: colors.text.secondary,
            marginBottom: 24,
            opacity: interpolate(frame, [20, 40], [0, 1], {extrapolateRight: 'clamp'}),
          }}>
            {steps[currentStep].desc}
          </div>

          {steps[currentStep].lines && (
            <div style={{
              padding: '20px 24px',
              background: colors.background.terminal,
              borderRadius: 12,
              border: `1px solid ${colors.background.accent}`,
              boxShadow: '0 20px 50px rgba(0,0,0,0.4)',
              fontFamily: 'monospace',
              fontSize: 13,
              opacity: interpolate(frame, [40, 60], [0, 1], {extrapolateRight: 'clamp'}),
            }}>
              {steps[currentStep].lines!.map((line, idx) => (
                <div key={idx} style={{
                  color: line.color || colors.text.terminal,
                  marginBottom: 2,
                  opacity: interpolate(frame, [40 + idx * 3, 60 + idx * 3], [0, 1], {extrapolateRight: 'clamp'}),
                }}>
                  {line.text}
                </div>
              ))}
            </div>
          )}

          {(steps[currentStep] as any).isPull && (
            <div style={{
              opacity: interpolate(frame, [40, 70], [0, 1], {extrapolateRight: 'clamp'}),
            }}>
              <SyncAnimation type="pull" startFrame={start + 40} />
            </div>
          )}

          {(steps[currentStep] as any).isPush && (
            <div style={{
              opacity: interpolate(frame, [40, 70], [0, 1], {extrapolateRight: 'clamp'}),
            }}>
              <SyncAnimation type="push" startFrame={start + 40} />
            </div>
          )}
        </>
      ) : (
        <div style={{
          fontSize: 20,
          color: colors.text.secondary,
          textAlign: 'center',
          opacity: interpolate(frame, [200, 230], [0, 1], {extrapolateRight: 'clamp'}),
        }}>
          Three commands. Full control.
        </div>
      )}
    </AbsoluteFill>
  );
};

const ScopeScene: React.FC<SceneProps> = ({start}) => {
  const frame = useCurrentFrame() - start;
  const titleOpacity = interpolate(frame, [0, 30], [0, 1], {extrapolateRight: 'clamp'});
  const diagramOpacity = interpolate(frame, [30, 60], [0, 1], {extrapolateRight: 'clamp'});
  const exampleOpacity = interpolate(frame, [160, 190], [0, 1], {extrapolateRight: 'clamp'});

  return (
    <AbsoluteFill style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 80,
      gap: 50,
    }}>
      <div style={{
        fontSize: 28,
        color: colors.text.primary,
        fontWeight: 700,
        opacity: titleOpacity,
        textAlign: 'center',
      }}>
        User vs Project Scope
      </div>

      <div style={{opacity: diagramOpacity}}>
        <ScopeDiagram startFrame={start} />
      </div>

      <div style={{
        padding: '20px 28px',
        background: colors.background.terminal,
        borderRadius: 12,
        border: `1px solid ${colors.background.accent}`,
        fontFamily: 'monospace',
        fontSize: 14,
        opacity: exampleOpacity,
      }}>
        <div style={{color: colors.terminal.comment, marginBottom: 8}}>
          {'# Promote project -> user'}
        </div>
        <div style={{color: colors.text.terminal, marginBottom: 4}}>
          <span style={{color: colors.terminal.command}}>$</span> agents commands push my-command
        </div>
        <div style={{marginTop: 12, color: colors.glow.green}}>
          ✓ Now available in all projects
        </div>
      </div>
    </AbsoluteFill>
  );
};

const FeaturesScene: React.FC<SceneProps> = ({start}) => {
  const frame = useCurrentFrame() - start;

  const features = [
    {
      title: 'Commands',
      description: 'Add to all agents at once',
      example: 'agents commands add gh:user/commands',
      color: colors.glow.cyan,
      delay: 0,
    },
    {
      title: 'MCP Servers',
      description: 'Register across Claude, Codex, Gemini',
      example: 'agents mcp add swarm "npx @swarmify/agents-mcp"',
      color: colors.glow.purple,
      delay: 1,
    },
    {
      title: 'Auto-conversion',
      description: 'Markdown to TOML automatically',
      example: '# No manual conversion needed',
      color: colors.glow.blue,
      delay: 2,
    },
    {
      title: 'Version Pinning',
      description: 'Lock CLI versions in manifest',
      example: 'version: "2.0.65"',
      color: colors.glow.pink,
      delay: 3,
    },
  ];

  return (
    <AbsoluteFill style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 70,
      gap: 36,
    }}>
      <div style={{
        fontSize: 28,
        color: colors.text.primary,
        fontWeight: 700,
        textAlign: 'center',
        opacity: interpolate(frame, [0, 30], [0, 1], {extrapolateRight: 'clamp'}),
      }}>
        Everything in one CLI
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 24,
      }}>
        {features.map((feature) => (
          <FeatureCard
            key={feature.title}
            title={feature.title}
            description={feature.description}
            example={feature.example}
            color={feature.color}
            delay={feature.delay}
            startFrame={start}
          />
        ))}
      </div>
    </AbsoluteFill>
  );
};

const DemoScene: React.FC<SceneProps> = ({start}) => {
  const frame = useCurrentFrame() - start;

  const workflows = [
    {
      title: 'Check current state',
      command: 'agents status',
    },
    {
      title: 'Pull from GitHub',
      command: 'agents pull gh:muqsitnawaz/.agents',
      output: [
        {text: '✓ Found 15 commands', color: colors.terminal.success},
        {text: '✓ Installed 42 command instances', color: colors.terminal.success},
        {text: '✓ Registered 3 MCP servers', color: colors.terminal.success},
      ],
    },
    {
      title: 'Add new command',
      command: 'agents commands add gh:user/my-custom-commands',
      output: [
        {text: '✓ Found 2 commands', color: colors.terminal.success},
        {text: '✓ Installed to Claude, Codex, Gemini', color: colors.terminal.success},
      ],
    },
    {
      title: 'Push to GitHub',
      command: 'agents push',
      output: [
        {text: '+ Claude Code @ 2.0.65', color: colors.terminal.success},
        {text: '+ Codex @ 1.2.3', color: colors.terminal.success},
        {text: '', color: colors.text.terminal},
        {text: 'Next: cd, git add, commit, push', color: colors.terminal.comment},
      ],
    },
  ];

  const currentWorkflow = Math.min(Math.floor(frame / 45), workflows.length - 1);
  const showOutput = frame % 45 > 20;

  return (
    <AbsoluteFill style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 70,
      gap: 30,
    }}>
      <div style={{
        fontSize: 28,
        color: colors.text.primary,
        fontWeight: 700,
        textAlign: 'center',
        opacity: interpolate(frame, [0, 30], [0, 1], {extrapolateRight: 'clamp'}),
      }}>
        Quick workflow demo
      </div>

      <TerminalWindow width={850} height={400} title="Terminal">
        {workflows.slice(0, currentWorkflow + 1).map((workflow, idx) => (
          <div key={idx} style={{
            marginBottom: 20,
            opacity: interpolate(frame, [idx * 45 - 20, idx * 45], [0, 1], {extrapolateRight: 'clamp'}),
          }}>
            <div style={{
              color: colors.glow.cyan,
              fontFamily: 'monospace',
              fontSize: 14,
              marginBottom: 8,
            }}>
              <span style={{color: colors.terminal.command}}>$</span> {workflow.command}
            </div>
            {showOutput && idx === currentWorkflow && workflow.output && (
              <div style={{fontSize: 13}}>
                {workflow.output.map((line, lineIdx) => (
                  <div key={lineIdx} style={{
                    color: line.color,
                    marginBottom: 4,
                    opacity: interpolate(frame, [idx * 45 + 25, idx * 45 + 45], [0, 1], {extrapolateRight: 'clamp'}),
                  }}>
                    {line.text}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </TerminalWindow>
    </AbsoluteFill>
  );
};

const CTAScene: React.FC<SceneProps> = ({start: _start}) => {
  return (
    <AbsoluteFill style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 80,
      gap: 40,
    }}>
      <GlowText color={colors.glow.cyan} delay={0} size={1.8}>
        npm install -g @swarmify/agents-cli
      </GlowText>

      <div style={{
        padding: '20px 28px',
        background: colors.background.terminal,
        borderRadius: 12,
        border: `1px solid ${colors.background.accent}`,
        fontFamily: 'monospace',
        fontSize: 14,
        boxShadow: '0 20px 50px rgba(0,0,0,0.4)',
      }}>
        <div style={{color: colors.text.terminal, marginBottom: 8}}>
          <span style={{color: colors.terminal.command}}>$</span> agents pull gh:yourname/.agents
        </div>
      </div>

      <div style={{
        fontSize: 26,
        color: colors.text.primary,
        fontWeight: 600,
        textAlign: 'center',
      }}>
        Your agents. Dotfile-managed. Git-synced.
      </div>

      <div style={{
        fontSize: 18,
        color: colors.text.tertiary,
        fontFamily: 'monospace',
        marginTop: 20,
      }}>
        github.com/muqsitnawaz/swarmify
      </div>
    </AbsoluteFill>
  );
};

const FadeScene: React.FC<{children: React.ReactNode, start: number, end: number}> = ({children, start, end}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [start, start + 15, end - 15, end], [0, 1, 1, 0], {extrapolateRight: 'clamp'});

  return (
    <AbsoluteFill style={{opacity}}>
      {children}
    </AbsoluteFill>
  );
};

export const Root: React.FC = () => {
  const frame = useCurrentFrame();

  const scenes = {
    hook: {start: 0, end: 180},
    problem: {start: 165, end: 330},
    solution: {start: 315, end: 510},
    scope: {start: 495, end: 720},
    features: {start: 705, end: 900},
    demo: {start: 885, end: 1080},
    cta: {start: 1065, end: 1200},
  };

  return (
    <>
      <Background />
      <AbsoluteFill>
        {frame < scenes.hook.end && (
          <FadeScene start={scenes.hook.start} end={scenes.hook.end}>
            <HookScene start={scenes.hook.start} />
          </FadeScene>
        )}
        {frame >= scenes.problem.start && frame < scenes.problem.end && (
          <FadeScene start={scenes.problem.start} end={scenes.problem.end}>
            <ProblemScene start={scenes.problem.start} />
          </FadeScene>
        )}
        {frame >= scenes.solution.start && frame < scenes.solution.end && (
          <FadeScene start={scenes.solution.start} end={scenes.solution.end}>
            <SolutionScene start={scenes.solution.start} />
          </FadeScene>
        )}
        {frame >= scenes.scope.start && frame < scenes.scope.end && (
          <FadeScene start={scenes.scope.start} end={scenes.scope.end}>
            <ScopeScene start={scenes.scope.start} />
          </FadeScene>
        )}
        {frame >= scenes.features.start && frame < scenes.features.end && (
          <FadeScene start={scenes.features.start} end={scenes.features.end}>
            <FeaturesScene start={scenes.features.start} />
          </FadeScene>
        )}
        {frame >= scenes.demo.start && frame < scenes.demo.end && (
          <FadeScene start={scenes.demo.start} end={scenes.demo.end}>
            <DemoScene start={scenes.demo.start} />
          </FadeScene>
        )}
        {frame >= scenes.cta.start && (
          <FadeScene start={scenes.cta.start} end={scenes.cta.end}>
            <CTAScene start={scenes.cta.start} />
          </FadeScene>
        )}
      </AbsoluteFill>
    </>
  );
};
