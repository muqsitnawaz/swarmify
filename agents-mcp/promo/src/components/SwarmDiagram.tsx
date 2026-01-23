import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {colors} from '../styles/colors';
import {AgentNode} from './AgentNode';
import {TypeWriter} from './TypeWriter';

interface SwarmDiagramProps {
  active?: boolean;
  startTime?: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export const SwarmDiagram: React.FC<SwarmDiagramProps> = ({active = false, startTime = 0}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const startFrame = startTime * fps;
  const relativeFrame = frame - startFrame;
  const relFrame = Math.max(relativeFrame, 0);

  const parent = {
    label: 'CC',
    name: 'Claude',
    role: 'Lead',
    color: colors.agents.claude,
    x: 360,
    y: 150,
    delay: 0,
  };

  const children = [
    {label: 'CX', name: 'Codex', role: 'Specialist', color: colors.agents.codex, x: 200, y: 340, delay: 0.5, task: 'API wiring'},
    {label: 'GE', name: 'Gemini', role: 'Specialist', color: colors.agents.gemini, x: 360, y: 390, delay: 0.9, task: 'Edge cases'},
    {label: 'CR', name: 'Cursor', role: 'Specialist', color: colors.agents.cursor, x: 520, y: 340, delay: 1.3, task: 'Trace & fix'},
  ];

  const container = {width: 720, height: 520};

  const childProgress = children.map((child) =>
    clamp((relFrame - child.delay * fps) / (fps * 2.6), 0, 1)
  );

  const aggregateProgress = childProgress.reduce((sum, p) => sum + p, 0) / childProgress.length;

  const haloPulse = active
    ? interpolate(relFrame % 60, [0, 30], [0, 1], {extrapolate: 'clamp'})
    : 0;

  const treeOpacity = interpolate(relFrame, [0, 20], [0, 0.9], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const taskLineDash = 32;
  const resultLineDash = 26;

  const flowDashOffset = (start: number, dash: number, speedFactor = 1) => {
    if (!active) return dash;
    const elapsed = Math.max(relativeFrame - start, 0);
    const period = fps * (1.4 / speedFactor);
    return interpolate(elapsed % period, [0, period], [dash, 0], {extrapolateRight: 'clamp'});
  };

  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: container.width,
          height: container.height,
        }}
      >
        <svg
          style={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            opacity: treeOpacity,
          }}
        >
          <defs>
            <linearGradient id="taskFlow" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={colors.glow.cyan} stopOpacity="0.9" />
              <stop offset="100%" stopColor={colors.glow.purple} stopOpacity="0.9" />
            </linearGradient>
            <linearGradient id="resultFlow" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={colors.glow.blue} stopOpacity="0.9" />
              <stop offset="100%" stopColor={colors.glow.pink} stopOpacity="0.9" />
            </linearGradient>
            <marker
              id="arrowHeadTask"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={colors.glow.cyan} />
            </marker>
            <marker
              id="arrowHeadResult"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={colors.glow.pink} />
            </marker>
            <filter id="treeGlow">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <path
            d={`M 60 ${parent.y} Q ${parent.x - 140} ${parent.y - 20} ${parent.x - 70} ${parent.y - 6} T ${parent.x} ${parent.y - 4}`}
            stroke="url(#taskFlow)"
            strokeWidth={3}
            strokeOpacity={0.7}
            fill="none"
            strokeDasharray={taskLineDash}
            strokeDashoffset={flowDashOffset(startFrame, taskLineDash, 1.2)}
            markerEnd="url(#arrowHeadTask)"
            filter="url(#treeGlow)"
          />

          {children.map((child, index) => {
            const startY = parent.y + 60;
            const controlY = (parent.y + child.y) / 2 - 30;
            const endY = child.y - 60;
            const startX = parent.x;
            const endX = child.x;
            const lineStart = startFrame + child.delay * fps * 0.9;
            const resultStart = startFrame + child.delay * fps + fps * 1.4;

            return (
              <g key={child.label}>
                <path
                  d={`M ${startX} ${startY} Q ${startX} ${controlY} ${endX} ${endY}`}
                  stroke="url(#taskFlow)"
                  strokeWidth={3}
                  strokeOpacity={0.9}
                  fill="none"
                  strokeDasharray={taskLineDash}
                  strokeDashoffset={flowDashOffset(lineStart, taskLineDash, 1 + index * 0.15)}
                  markerEnd="url(#arrowHeadTask)"
                  filter="url(#treeGlow)"
                />
                <path
                  d={`M ${endX} ${endY} Q ${startX} ${controlY + 30} ${startX} ${startY - 10}`}
                  stroke="url(#resultFlow)"
                  strokeWidth={2.4}
                  strokeOpacity={0.85}
                  fill="none"
                  strokeDasharray={resultLineDash}
                  strokeDashoffset={flowDashOffset(resultStart, resultLineDash, 1.4)}
                  markerEnd="url(#arrowHeadResult)"
                  filter="url(#treeGlow)"
                  style={{opacity: childProgress[index] > 0.4 ? 1 : 0}}
                />
                <text
                  x={(startX + endX) / 2}
                  y={controlY - 8}
                  fill={colors.text.secondary}
                  fontSize="12"
                  fontWeight="600"
                  textAnchor="middle"
                >
                  {child.task}
                </text>
              </g>
            );
          })}
        </svg>

        <AgentNode
          label={parent.label}
          name={parent.name}
          role={parent.role}
          color={parent.color}
          delay={parent.delay}
          x={parent.x}
          y={parent.y}
          isParent
          active={active}
          progress={aggregateProgress}
          size={150}
        />

        {children.map((child, index) => {
          const elapsedSeconds = Math.max(relativeFrame / fps - child.delay, 0);
          const remaining = Math.max(2.6 - elapsedSeconds, 0);
          const status = childProgress[index] >= 1 ? `${(child.delay + 2.6).toFixed(1)}s` : `ETA ${remaining.toFixed(1)}s`;

          return (
            <React.Fragment key={child.label}>
              <AgentNode
                label={child.label}
                name={child.name}
                role={child.role}
                color={child.color}
                delay={child.delay}
                x={child.x}
                y={child.y}
                active={active}
                progress={childProgress[index]}
                size={110}
              />
              <div
                style={{
                  position: 'absolute',
                  left: child.x - 60,
                  top: child.y + 70,
                  color: colors.text.secondary,
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {status}
              </div>
            </React.Fragment>
          );
        })}

        <div
          style={{
            position: 'absolute',
            left: parent.x - 110,
            top: parent.y - 120,
            color: colors.text.primary,
            fontSize: '16px',
            fontWeight: 700,
            letterSpacing: 0.3,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <TypeWriter
            text="User request → Claude (lead) → Codex, Gemini, Cursor"
            charsPerSecond={18}
            startFrame={startFrame}
            style={{color: colors.text.primary}}
          />
        </div>

        <div
          style={{
            position: 'absolute',
            bottom: 22,
            left: 24,
            padding: '10px 12px',
            background: 'rgba(15,15,25,0.7)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 10,
            color: colors.text.secondary,
            fontSize: 11,
            fontWeight: 600,
            display: 'grid',
            gridTemplateColumns: 'repeat(5, auto)',
            gap: '6px 10px',
            backdropFilter: 'blur(6px)',
          }}
        >
          <span style={{color: colors.text.primary}}>Parent</span>
          <span style={{color: colors.text.primary}}>Children</span>
          <span style={{color: colors.text.primary}}>Task Flow</span>
          <span style={{color: colors.text.primary}}>Result Flow</span>
          <span style={{color: colors.text.primary}}>Approval</span>
          <span>Claude</span>
          <span>CX, GE, CR</span>
          <span>Splits</span>
          <span>Converges</span>
          <span>On parent</span>
        </div>

        <div
          style={{
            position: 'absolute',
            bottom: 18,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '10px 16px',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 12,
            color: colors.text.secondary,
            fontSize: 14,
            fontWeight: 600,
            backdropFilter: 'blur(8px)',
          }}
        >
          Claude (lead) orchestrates → Codex, Gemini, Cursor | synth progress: {(aggregateProgress * 100).toFixed(0)}%
        </div>

        <div
          style={{
            position: 'absolute',
            left: parent.x - 55,
            top: parent.y + 12,
            width: 110,
            height: 110,
            borderRadius: '50%',
            boxShadow: `0 0 ${20 + haloPulse * 30}px ${colors.glow.cyan}`,
            opacity: 0.4 + haloPulse * 0.35,
            filter: 'blur(6px)',
            pointerEvents: 'none',
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
