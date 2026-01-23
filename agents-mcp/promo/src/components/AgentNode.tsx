import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig, spring} from 'remotion';

interface AgentNodeProps {
  label: string;
  name: string;
  role: string;
  color: string;
  delay: number;
  x: number;
  y: number;
  active?: boolean;
  progress?: number;
  isParent?: boolean;
  size?: number;
}

export const AgentNode: React.FC<AgentNodeProps> = ({
  label,
  name,
  role,
  color,
  delay,
  x,
  y,
  active = false,
  progress = 0,
  isParent = false,
  size,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const startFrame = delay * fps;
  const localFrame = Math.max(frame - startFrame, 0);
  const springConfig = {damping: 200, stiffness: 100, mass: 1};
  const scale = spring({frame: localFrame, fps, config: springConfig});
  const opacity = interpolate(frame, [startFrame, startFrame + 15], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const pulse = active
    ? interpolate(localFrame % 45, [0, 22.5], [0, 1], {extrapolate: 'clamp'})
    : 0;

  const progressOpacity = active
    ? interpolate(localFrame, [30, 60], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    })
    : 0;

  const ringRotation = active
    ? interpolate(localFrame % 60, [0, 60], [0, 360], {extrapolateRight: 'clamp'})
    : 0;

  const baseSize = size ?? (isParent ? 140 : 100);
  const glowSize = (isParent ? 35 : 25) + pulse * 40;
  const radius = baseSize / 2;

  return (
    <div
      style={{
        position: 'absolute',
        width: baseSize,
        height: baseSize,
        left: x - radius,
        top: y - radius,
        transform: `scale(${scale})`,
        opacity,
      }}
    >
      <div
        style={{
          width: baseSize,
          height: baseSize,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${color}dd 0%, ${color}88 50%, ${color}33 100%)`,
          boxShadow: `0 0 ${glowSize}px ${color}, inset 0 0 ${isParent ? 30 : 20}px ${color}44`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          fontSize: isParent ? '32px' : '22px',
          fontWeight: 800,
          color: '#ffffff',
          textShadow: '0 2px 6px rgba(0,0,0,0.6)',
          border: `${isParent ? 3 : 2}px solid rgba(255,255,255,0.18)`,
        }}
      >
        {label}
        <span
          style={{
            marginTop: 6,
            fontSize: isParent ? '14px' : '12px',
            letterSpacing: 0.5,
            fontWeight: 600,
            color: '#e5e7eb',
            textShadow: '0 1px 3px rgba(0,0,0,0.4)',
          }}
        >
          {name}
        </span>
        <span
          style={{
            marginTop: 2,
            padding: '2px 8px',
            fontSize: '11px',
            fontWeight: 700,
            color: isParent ? '#0b0b0f' : '#0a0a0f',
            background: isParent ? '#fef3c7' : '#e0e7ff',
            borderRadius: 999,
            textTransform: 'uppercase',
            letterSpacing: 0.8,
          }}
        >
          {role}
        </span>
      </div>
      {active && progressOpacity > 0 && (
        <AbsoluteFill
          style={{
            borderRadius: '50%',
            background: `conic-gradient(${color} ${Math.min(Math.max(progress, 0), 1) * 360}deg, rgba(255,255,255,0.04) 0deg)`,
            opacity: progressOpacity,
            mixBlendMode: 'screen',
            transform: `rotate(${ringRotation}deg)`,
          }}
        />
      )}
    </div>
  );
};
