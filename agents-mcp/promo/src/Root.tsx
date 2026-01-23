import React from 'react';
import {AbsoluteFill, useCurrentFrame, interpolate, useVideoConfig} from 'remotion';
import {colors} from './styles/colors';
import {GlowText} from './components/GlowText';
import {SwarmDiagram} from './components/SwarmDiagram';
import {Background} from './components/Background';
import {TypeWriter} from './components/TypeWriter';

interface SceneProps {
  start: number;
}

const IntroScene: React.FC<SceneProps> = ({start}) => {
  const frame = useCurrentFrame() - start;
  const secondaryOpacity = interpolate(frame, [60, 100], [0, 1], {extrapolateRight: 'clamp'});
  const tertiaryOpacity = interpolate(frame, [90, 130], [0, 1], {extrapolateRight: 'clamp'});
  const approvalOpacity = interpolate(frame, [120, 160], [0, 1], {extrapolateRight: 'clamp'});

  return (
    <AbsoluteFill style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 80,
    }}>
      <GlowText color={colors.glow.cyan} delay={0} size={2.2}>
        True multi-agent
      </GlowText>
      <GlowText color={colors.glow.purple} delay={0.6} size={2.2}>
        coding in your IDE
      </GlowText>
      <div style={{
        marginTop: 50,
        fontSize: '20px',
        color: colors.text.secondary,
        opacity: secondaryOpacity,
        textAlign: 'center',
      }}>
        Run specialized agents in parallel. You stay in control.
      </div>
      <div style={{
        marginTop: 14,
        fontSize: '20px',
        color: colors.text.secondary,
        opacity: tertiaryOpacity,
        textAlign: 'center',
      }}>
        Mix of Agents for every task.
      </div>
      <div style={{
        marginTop: 14,
        fontSize: '18px',
        color: colors.text.tertiary,
        opacity: approvalOpacity,
        textAlign: 'center',
      }}>
        Approvals-first orchestration, not just parallelism.
      </div>
    </AbsoluteFill>
  );
};

const ProblemScene: React.FC<SceneProps> = ({start}) => {
  const frame = useCurrentFrame() - start;
  const floodOpacity = Math.min(1, Math.max(0, (frame - 40) / 45));
  const scrollY = Math.min(200, Math.max(0, (frame - 70) / 60 * 200));
  const flashIntensity = interpolate(frame, [100, 140], [0, 1], {extrapolateRight: 'clamp'}) * floodOpacity;
  const coordinationOpacity = interpolate(frame, [90, 130], [0, 1], {extrapolateRight: 'clamp'});

  const painPoints = [
    'Approvals scattered across chats',
    'Who owns which agent?',
    'Manual coordination slows everything down',
    'Guardrails missing when stakes are high',
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
      <div style={{display: 'flex', gap: 32, alignItems: 'stretch', justifyContent: 'center'}}>
        <div style={{
          position: 'relative',
          width: 640,
          height: 400,
          background: '#0d0d15',
          borderRadius: 12,
          border: `1px solid ${colors.background.accent}`,
          overflow: 'hidden',
          boxShadow: `0 0 ${20 + flashIntensity * 30}px rgba(239, 68, 68, ${flashIntensity * 0.3})`,
        }}>
          <div style={{
            height: 32,
            background: '#1a1a2e',
            borderBottom: `1px solid ${colors.background.accent}`,
            display: 'flex',
            alignItems: 'center',
            paddingLeft: 12,
            gap: 8,
          }}>
            <div style={{width: 12, height: 12, borderRadius: '50%', background: '#ff5f57'}} />
            <div style={{width: 12, height: 12, borderRadius: '50%', background: '#ffbd2e'}} />
            <div style={{width: 12, height: 12, borderRadius: '50%', background: '#28ca42'}} />
          </div>
          <div style={{
            padding: 20,
            fontFamily: 'monospace',
            fontSize: '14px',
            color: colors.text.secondary,
            overflow: 'hidden',
            position: 'relative',
          }}>
            <div style={{transform: `translateY(${-scrollY}px)`}}>
              <div><span style={{color: colors.code.keyword}}>const</span> <span style={{color: colors.code.function}}>task</span> = await agent.<span style={{color: colors.code.string}}>execute</span>(prompt);</div>
              <div style={{marginTop: 8}}><span style={{color: colors.code.comment}}>/// Context window: 100,000 tokens</span></div>
              <div><span style={{color: colors.code.keyword}}>const</span> <span style={{color: colors.code.function}}>files</span> = <span style={{color: colors.code.keyword}}>await</span> <span style={{color: colors.code.function}}>readAll</span>(<span style={{color: colors.code.string}}>'src/**/*'</span>);</div>
              <div><span style={{color: colors.code.keyword}}>const</span> <span style={{color: colors.code.function}}>docs</span> = <span style={{color: colors.code.keyword}}>await</span> <span style={{color: colors.code.function}}>searchDocs</span>(prompt);</div>
              <div><span style={{color: colors.code.keyword}}>const</span> <span style={{color: colors.code.function}}>history</span> = <span style={{color: colors.code.keyword}}>await</span> <span style={{color: colors.code.function}}>getHistory</span>(<span style={{color: colors.code.number}}>1000</span>);</div>
              <div><span style={{color: colors.code.keyword}}>const</span> <span style={{color: colors.code.function}}>context</span> = [files, docs, history...].flat();</div>
              <div style={{marginTop: 8}}><span style={{color: colors.code.comment}}>/// Adding more context...</span></div>
              <div style={{marginTop: 8, opacity: floodOpacity}}>Loading 47 files...</div>
              <div style={{marginTop: 8, opacity: floodOpacity}}>Parsing 128 docs...</div>
              <div style={{marginTop: 8, opacity: floodOpacity}}><span style={{color: '#f59e0b'}}>Warning</span>: Context overflow imminent</div>
              <div style={{marginTop: 8, opacity: floodOpacity, color: '#ef4444', textShadow: `0 0 ${flashIntensity * 10}px #ef4444`}}>ERROR: Agent overwhelmed</div>
            </div>
          </div>
        </div>

        <div style={{
          width: 320,
          background: '#111122',
          borderRadius: 12,
          border: `1px solid ${colors.background.accent}`,
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          boxShadow: '0 10px 40px rgba(0,0,0,0.35)',
          opacity: coordinationOpacity,
        }}>
          <GlowText color={colors.glow.pink} delay={0} size={1.1}>
            Coordination failure
          </GlowText>
          <TypeWriter
            text="Complex tasks need guardrails. Coordinating multiple agents is manual and error-prone."
            charsPerSecond={18}
            startFrame={start + 100}
            style={{color: colors.text.secondary, fontSize: 16, lineHeight: 1.5}}
          />
          <div style={{display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8}}>
            {painPoints.map((point, idx) => (
              <div key={point} style={{
                padding: '10px 12px',
                borderRadius: 8,
                background: '#1a1a2e',
                color: colors.text.secondary,
                border: `1px solid ${colors.background.accent}`,
                opacity: interpolate(frame, [100 + idx * 10, 120 + idx * 10], [0, 1], {extrapolateRight: 'clamp'}),
                fontSize: 14,
              }}>
                {point}
              </div>
            ))}
          </div>
          <div style={{
            marginTop: 'auto',
            fontSize: 14,
            color: '#ef4444',
            textAlign: 'right',
          }}>
            No approvals. No orchestration.
          </div>
        </div>
      </div>

      <div style={{
        fontSize: '26px',
        color: colors.text.primary,
        fontWeight: 600,
        textAlign: 'center',
      }}>
        Context overflow + manual coordination = failure
      </div>
    </AbsoluteFill>
  );
};

const SolutionScene: React.FC<SceneProps> = ({start}) => {
  const frame = useCurrentFrame() - start;
  const tools = [
    {name: 'spawn', color: colors.glow.cyan, desc: 'Create subagents'},
    {name: 'status', color: colors.glow.purple, desc: 'Track progress'},
    {name: 'stop', color: colors.glow.blue, desc: 'Halt execution'},
    {name: 'tasks', color: colors.glow.pink, desc: 'List agents'},
  ];

  const steps = [
    {label: '1', title: 'Run /swarm', desc: 'Start inside your IDE'},
    {label: '2', title: 'Agents plan', desc: 'They draft the approach'},
    {label: '3', title: 'You approve', desc: 'Guardrails at every step'},
  ];

  return (
    <AbsoluteFill style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 80,
      gap: 36,
    }}>
      <GlowText color={colors.text.primary} delay={0} size={1.8}>
        Start with <span style={{color: colors.glow.cyan}}>/swarm</span>
      </GlowText>
      <TypeWriter
        text="/swarm \"Ship onboarding\" mix=Claude:20,Gemini:30,Codex:35,Cursor:15"
        charsPerSecond={22}
        startFrame={start + 30}
        style={{
          fontFamily: 'monospace',
          background: '#111122',
          padding: '14px 18px',
          borderRadius: 10,
          border: `1px solid ${colors.background.accent}`,
          color: colors.text.primary,
          fontSize: 16,
        }}
      />
      <div style={{display: 'flex', gap: 28, flexWrap: 'wrap', justifyContent: 'center'}}>
        {steps.map((step, idx) => (
          <div key={step.title} style={{
            width: 210,
            padding: 18,
            borderRadius: 12,
            background: '#0f101d',
            border: `1px solid ${colors.background.accent}`,
            boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
            opacity: interpolate(frame, [20 + idx * 10, 50 + idx * 10], [0, 1], {extrapolateRight: 'clamp'}),
          }}>
            <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
              <div style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: colors.glow.cyan,
                color: '#000',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                {step.label}
              </div>
              <div style={{fontSize: 16, color: colors.text.primary, fontWeight: 600}}>{step.title}</div>
            </div>
            <div style={{marginTop: 10, color: colors.text.secondary, fontSize: 14}}>{step.desc}</div>
          </div>
        ))}
      </div>
      <GlowText color={colors.glow.purple} delay={0.2} size={1.2}>
        Mix of Agents is built in
      </GlowText>
      <div style={{display: 'flex', gap: 28, alignItems: 'center', color: colors.text.tertiary, fontSize: 14}}>
        {tools.map((tool) => (
          <div key={tool.name} style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6}}>
            <div style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: `${tool.color}22`,
              border: `1px solid ${tool.color}55`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: tool.color,
              fontWeight: 700,
            }}>
              {tool.name}
            </div>
            <div>{tool.desc}</div>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const DemoScene: React.FC<SceneProps> = ({start}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const headingOpacity = interpolate(frame, [start, start + 20], [0, 1], {extrapolateRight: 'clamp'});
  const microOpacity = interpolate(frame, [start + 20, start + 50], [0, 1], {extrapolateRight: 'clamp'});
  const legendOpacity = interpolate(frame, [start + 40, start + 80], [0, 1], {extrapolateRight: 'clamp'});
  const diagramStartTime = start / fps;

  const flowMessages = [
    {text: 'User: Build onboarding with tests. Favor Codex + Cursor.', start: start + 25},
    {text: 'Parent agent plans and asks for approval.', start: start + 90},
    {text: 'Parent spawns children with the requested mix.', start: start + 140},
    {text: 'Children execute in parallel. Results merge back to parent.', start: start + 185},
    {text: 'User: "I need mostly Codex and Cursor for this task..." Mix adapts mid-task.', start: start + 210},
  ];

  return (
    <AbsoluteFill style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        position: 'absolute',
        top: 60,
        left: '50%',
        transform: 'translateX(-50%)',
        opacity: headingOpacity,
      }}>
        <GlowText color={colors.text.primary} delay={0} size={1.4}>
          Hierarchical Orchestration
        </GlowText>
      </div>
      <div style={{
        position: 'absolute',
        top: 110,
        right: 80,
        color: colors.text.secondary,
        fontSize: 16,
        opacity: microOpacity,
      }}>
        Approvals built in at every step
      </div>

      <SwarmDiagram active={true} startTime={diagramStartTime} />

      <div style={{
        position: 'absolute',
        bottom: 140,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 760,
        padding: '16px 20px',
        background: '#0f101d',
        border: `1px solid ${colors.background.accent}`,
        borderRadius: 12,
        boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}>
        {flowMessages.map((message) => (
          <TypeWriter
            key={message.text}
            text={message.text}
            charsPerSecond={20}
            startFrame={message.start}
            style={{
              color: colors.text.secondary,
              fontSize: 15,
              lineHeight: 1.4,
              opacity: interpolate(frame, [message.start - 5, message.start + 40], [0, 1], {extrapolateRight: 'clamp'}),
            }}
          />
        ))}
      </div>

      <div style={{
        position: 'absolute',
        left: 80,
        bottom: 80,
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        gap: 10,
        alignItems: 'center',
        background: '#101122',
        padding: '12px 16px',
        borderRadius: 10,
        border: `1px solid ${colors.background.accent}`,
        opacity: legendOpacity,
      }}>
        {[
          {name: 'Claude', role: 'planning', color: colors.agents.claude},
          {name: 'Gemini', role: 'research', color: colors.agents.gemini},
          {name: 'Codex', role: 'coding', color: colors.agents.codex},
          {name: 'Cursor', role: 'debugging', color: colors.agents.cursor},
        ].map((item) => (
          <React.Fragment key={item.name}>
            <div style={{width: 12, height: 12, borderRadius: '50%', background: item.color}} />
            <div style={{color: colors.text.secondary, fontSize: 14}}>{item.name} ({item.role})</div>
          </React.Fragment>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const MixScene: React.FC<SceneProps> = ({start}) => {
  const frame = useCurrentFrame();
  const barOpacity = interpolate(frame, [start + 20, start + 60], [0, 1], {extrapolateRight: 'clamp'});
  const examples = [
    {
      title: 'Research-heavy',
      desc: 'Add 70% Gemini. Keep Claude for approvals.',
      mix: [
        {label: 'Gemini', pct: 70, color: colors.agents.gemini},
        {label: 'Claude', pct: 20, color: colors.agents.claude},
        {label: 'Codex', pct: 10, color: colors.agents.codex},
      ],
    },
    {
      title: 'Debug focus',
      desc: 'Need debugging? Add 50% Cursor, 30% Codex.',
      mix: [
        {label: 'Cursor', pct: 50, color: colors.agents.cursor},
        {label: 'Codex', pct: 30, color: colors.agents.codex},
        {label: 'Claude', pct: 20, color: colors.agents.claude},
      ],
    },
  ];

  return (
    <AbsoluteFill style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 70,
      gap: 28,
    }}>
      <GlowText color={colors.glow.cyan} delay={0} size={1.6}>
        Mix of Agents
      </GlowText>
      <div style={{color: colors.text.secondary, fontSize: 18, textAlign: 'center', maxWidth: 800}}>
        Model diversity prevents blind spots. You get specialized expertise per task.
      </div>

      <div style={{
        display: 'flex',
        gap: 22,
        flexWrap: 'wrap',
        justifyContent: 'center',
      }}>
        {examples.map((example, idx) => (
          <div key={example.title} style={{
            width: 360,
            padding: 18,
            borderRadius: 12,
            background: '#0f101d',
            border: `1px solid ${colors.background.accent}`,
            boxShadow: '0 12px 30px rgba(0,0,0,0.35)',
            opacity: interpolate(frame, [start + 10 + idx * 10, start + 40 + idx * 10], [0, 1], {extrapolateRight: 'clamp'}),
          }}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
              <div style={{color: colors.text.primary, fontWeight: 700, fontSize: 18}}>{example.title}</div>
              <div style={{color: colors.text.tertiary, fontSize: 13}}>Orchestrator interprets and assembles</div>
            </div>
            <div style={{marginTop: 10, color: colors.text.secondary, fontSize: 15}}>
              {example.desc}
            </div>
            <div style={{
              marginTop: 14,
              display: 'flex',
              height: 20,
              borderRadius: 10,
              overflow: 'hidden',
              border: `1px solid ${colors.background.accent}`,
              opacity: barOpacity,
            }}>
              {example.mix.map((part) => (
                <div key={part.label} style={{
                  width: `${part.pct}%`,
                  background: `${part.color}cc`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#05050a',
                  fontSize: 12,
                  fontWeight: 700,
                }}>
                  {part.pct}%
                </div>
              ))}
            </div>
            <div style={{marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 10}}>
              {example.mix.map((part) => (
                <div key={part.label} style={{
                  padding: '6px 8px',
                  borderRadius: 8,
                  background: `${part.color}22`,
                  color: colors.text.secondary,
                  border: `1px solid ${colors.background.accent}`,
                  fontSize: 13,
                }}>
                  {part.label}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const CTAScene: React.FC<SceneProps> = ({start: _start}) => (
  <AbsoluteFill style={{
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 80,
  }}>
    <GlowText color={colors.glow.cyan} delay={0} size={1.6}>
      Start with <span style={{color: colors.glow.purple}}>/swarm</span> in your IDE
    </GlowText>
    <div style={{
      marginTop: 40,
      fontSize: '24px',
      color: colors.text.primary,
      fontWeight: 600,
      textAlign: 'center',
    }}>
      No dashboards. No new infra. Mix of Agents in every project.
    </div>
    <div style={{
      marginTop: 50,
      fontSize: '18px',
      color: colors.text.secondary,
      textAlign: 'center',
    }}>
      /swarm keeps everything IDE-native.
    </div>
  </AbsoluteFill>
);

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
    intro: {start: 0, end: 180},
    problem: {start: 165, end: 330},
    solution: {start: 315, end: 510},
    demo: {start: 495, end: 720},
    mix: {start: 705, end: 900},
    cta: {start: 885, end: 1050},
  };

  return (
    <>
      <Background />
      <AbsoluteFill>
        {frame < scenes.intro.end && (
          <FadeScene start={scenes.intro.start} end={scenes.intro.end}>
            <IntroScene start={scenes.intro.start} />
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
        {frame >= scenes.demo.start && frame < scenes.demo.end && (
          <FadeScene start={scenes.demo.start} end={scenes.demo.end}>
            <DemoScene start={scenes.demo.start} />
          </FadeScene>
        )}
        {frame >= scenes.mix.start && frame < scenes.mix.end && (
          <FadeScene start={scenes.mix.start} end={scenes.mix.end}>
            <MixScene start={scenes.mix.start} />
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
