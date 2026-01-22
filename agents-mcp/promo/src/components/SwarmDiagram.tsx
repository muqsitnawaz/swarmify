import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring} from 'remotion';
import {colors} from '../styles/colors';
import {AgentNode} from './AgentNode';

interface SwarmDiagramProps {
  active?: boolean;
  startTime?: number;
}

export const SwarmDiagram: React.FC<SwarmDiagramProps> = ({active = false, startTime = 0}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const startFrame = startTime * fps;
  const relativeFrame = frame - startFrame;

  const springConfig = {damping: 200, stiffness: 100, mass: 1};

  const progress1 = interpolate(relativeFrame % (3 * fps), [0, 3 * fps], [0, 1], {extrapolateRight: 'clamp'});
  const progress2 = interpolate((relativeFrame - fps) % (3 * fps), [0, 3 * fps], [0, 1], {extrapolateRight: 'clamp'});
  const progress3 = interpolate((relativeFrame - 2 * fps) % (3 * fps), [0, 3 * fps], [0, 1], {extrapolateRight: 'clamp'});
  const progress4 = interpolate((relativeFrame - 3 * fps) % (3 * fps), [0, 3 * fps], [0, 1], {extrapolateRight: 'clamp'});

  const lineOpacity = interpolate(relativeFrame, [0, 30], [0, 0.7], {extrapolateRight: 'clamp'});
  const mcpScale = spring({frame: relativeFrame, fps, config: springConfig});
  const mcpOpacity = interpolate(relativeFrame, [0, 20], [0, 1], {extrapolateRight: 'clamp'});

  const dashOffset1 = active ? interpolate(relativeFrame % (2 * fps), [0, 2 * fps], [30, 0], {extrapolateRight: 'clamp'}) : 0;
  const dashOffset2 = active ? interpolate((relativeFrame + 15) % (2 * fps), [0, 2 * fps], [30, 0], {extrapolateRight: 'clamp'}) : 0;

  const agentPositions = [
    {x: 150, y: 150, delay: 0},
    {x: 450, y: 150, delay: 5},
    {x: 150, y: 450, delay: 10},
    {x: 450, y: 450, delay: 15},
  ];

  return (
    <AbsoluteFill style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        position: 'relative',
        width: 600,
        height: 600,
      }}>
        <svg style={{
          position: 'absolute',
          width: '100%',
          height: '100%',
          opacity: lineOpacity,
        }}>
          <defs>
            <linearGradient id="lineGradient1" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={colors.glow.cyan} stopOpacity="0.8" />
              <stop offset="100%" stopColor={colors.glow.purple} stopOpacity="0.8" />
            </linearGradient>
            <filter id="glow">
              <feGaussianBlur stdDeviation="2" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {agentPositions.map((pos, i) => (
            <line
              key={i}
              x1="300" y1="300"
              x2={pos.x} y2={pos.y}
              stroke={i === 0 ? colors.glow.cyan : i === 1 ? colors.glow.purple : i === 2 ? colors.glow.blue : colors.glow.pink}
              strokeWidth={2}
              strokeOpacity={0.6}
              strokeDasharray={active ? '10,5' : '0'}
              strokeDashoffset={i < 2 ? dashOffset1 : dashOffset2}
              filter="url(#glow)"
            />
          ))}
        </svg>

        <AgentNode
          label="C"
          color={colors.agents.claude}
          delay={0}
          active={active}
          progress={progress1}
        />
        <AgentNode
          label="G"
          color={colors.agents.gemini}
          delay={0.17}
          active={active}
          progress={progress2}
        />
        <AgentNode
          label="X"
          color={colors.agents.codex}
          delay={0.33}
          active={active}
          progress={progress3}
        />
        <AgentNode
          label="S"
          color={colors.agents.cursor}
          delay={0.5}
          active={active}
          progress={progress4}
        />

        <div style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: 80,
          height: 80,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${colors.glow.cyan}dd 0%, ${colors.glow.cyan}88 50%, ${colors.glow.cyan}33 100%)`,
          boxShadow: `0 0 ${30 + (active ? interpolate(relativeFrame % 45, [0, 22.5], [0, 30], {extrapolateRight: 'clamp'}) : 0)}px ${colors.glow.cyan}, inset 0 0 20px ${colors.glow.cyan}44`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '20px',
          fontWeight: 700,
          color: '#000000',
          transform: `translate(-50%, -50%) scale(${mcpScale})`,
          opacity: mcpOpacity,
        }}>
          MCP
        </div>
      </div>
    </AbsoluteFill>
  );
};
