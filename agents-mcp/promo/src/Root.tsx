import React from 'react';
import {AbsoluteFill, useCurrentFrame, interpolate} from 'remotion';
import {colors} from './styles/colors';
import {GlowText} from './components/GlowText';
import {SwarmDiagram} from './components/SwarmDiagram';
import {Background} from './components/Background';

const IntroScene: React.FC = () => {
  const frame = useCurrentFrame();

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
      <GlowText color={colors.glow.purple} delay={1} size={2.2}>
        coding in your IDE
      </GlowText>
      <div style={{
        marginTop: 60,
        fontSize: '20px',
        color: colors.text.secondary,
        opacity: interpolate(frame, [90, 120], [0, 1], {extrapolateRight: 'clamp'}),
        textAlign: 'center',
      }}>
        Async subagent orchestration for MCP
      </div>
    </AbsoluteFill>
  );
};

const ProblemScene: React.FC = () => {
  const frame = useCurrentFrame();
  const floodOpacity = Math.min(1, Math.max(0, (frame - 60) / 45));
  const scrollY = Math.min(200, Math.max(0, (frame - 90) / 60 * 200));
  const flashIntensity = interpolate(frame, [120, 150], [0, 1], {extrapolateRight: 'clamp'}) * floodOpacity;

  return (
    <AbsoluteFill style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 80,
    }}>
      <div style={{
        position: 'relative',
        width: 700,
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
        marginTop: 40,
        fontSize: '28px',
        color: colors.text.primary,
        fontWeight: 600,
        textAlign: 'center',
      }}>
        Single agents drown in context
      </div>
    </AbsoluteFill>
  );
};

const SolutionScene: React.FC = () => {
  const tools = [
    {name: 'spawn', color: colors.glow.cyan, desc: 'Create subagents'},
    {name: 'status', color: colors.glow.purple, desc: 'Track progress'},
    {name: 'stop', color: colors.glow.blue, desc: 'Halt execution'},
    {name: 'tasks', color: colors.glow.pink, desc: 'List agents'},
  ];

  return (
    <AbsoluteFill style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 80,
    }}>
      <GlowText color={colors.text.primary} delay={0} size={1.8}>
        4 tools. That's it.
      </GlowText>
      <div style={{
        marginTop: 60,
        display: 'flex',
        gap: 50,
        flexWrap: 'wrap',
        justifyContent: 'center',
      }}>
        {tools.map((tool, i) => (
          <div key={tool.name} style={{textAlign: 'center'}}>
            <GlowText color={tool.color} delay={i * 0.4} size={1.5}>
              {tool.name}
            </GlowText>
            <div style={{
              marginTop: 16,
              fontSize: '16px',
              color: colors.text.secondary,
            }}>
              {tool.desc}
            </div>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const DemoScene: React.FC = () => {
  const frame = useCurrentFrame();
  const textOpacity = interpolate(frame, [0, 30], [0, 1], {extrapolateRight: 'clamp'});
  const subtextOpacity = interpolate(frame, [30, 60], [0, 1], {extrapolateRight: 'clamp'});

  return (
    <AbsoluteFill style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        position: 'absolute',
        top: 80,
        left: '50%',
        transform: 'translateX(-50%)',
        opacity: textOpacity,
      }}>
        <GlowText color={colors.text.primary} delay={0} size={1.4}>
          Parallel execution
        </GlowText>
      </div>
      <SwarmDiagram active={true} />
      <div style={{
        position: 'absolute',
        bottom: 120,
        left: '50%',
        transform: 'translateX(-50%)',
        fontSize: '20px',
        color: colors.text.secondary,
        textAlign: 'center',
        opacity: subtextOpacity,
      }}>
        <div>4 agents working simultaneously</div>
        <div style={{marginTop: 8}}>Each in its own context</div>
        <div style={{marginTop: 8}}>No context window limits</div>
      </div>
    </AbsoluteFill>
  );
};

const CTAScene: React.FC = () => (
  <AbsoluteFill style={{
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 80,
  }}>
    <GlowText color={colors.glow.cyan} delay={0} size={1.6}>
      npm i @swarmify/agents-mcp
    </GlowText>
    <div style={{
      marginTop: 40,
      fontSize: '24px',
      color: colors.text.primary,
      fontWeight: 600,
    }}>
      swarmify.co
    </div>
    <div style={{
      marginTop: 60,
      fontSize: '18px',
      color: colors.text.secondary,
      textAlign: 'center',
    }}>
      True multi-agent coding. No more context limits.
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

  return (
    <>
      <Background />
      <AbsoluteFill>
        {frame < 180 && <FadeScene start={0} end={180}><IntroScene /></FadeScene>}
        {frame >= 165 && frame < 330 && <FadeScene start={165} end={330}><ProblemScene /></FadeScene>}
        {frame >= 315 && frame < 540 && <FadeScene start={315} end={540}><SolutionScene /></FadeScene>}
        {frame >= 525 && frame < 780 && <FadeScene start={525} end={780}><DemoScene /></FadeScene>}
        {frame >= 765 && <FadeScene start={765} end={900}><CTAScene /></FadeScene>}
      </AbsoluteFill>
    </>
  );
};
