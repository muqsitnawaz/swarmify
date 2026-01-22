import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig, spring} from 'remotion';
import {colors} from '../styles/colors';

interface AgentNodeProps {
  label: string;
  color: string;
  delay: number;
  active?: boolean;
  progress?: number;
}

export const AgentNode: React.FC<AgentNodeProps> = ({label, color, delay, active = false, progress = 0}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const startFrame = delay * fps;
  const springConfig = {damping: 200, stiffness: 100, mass: 1};
  const scale = spring({frame: frame - startFrame, fps, config: springConfig});
  const opacity = interpolate(frame, [startFrame, startFrame + 15], [0, 1], {extrapolateRight: 'clamp'});

  const pulse = active
    ? interpolate(frame % 45, [0, 22.5], [0, 1], {extrapolate: 'clamp'})
    : 0;

  const progressOpacity = active ? interpolate(frame, [startFrame + 30, startFrame + 60], [0, 1], {extrapolateRight: 'clamp'}) : 0;

  const glowSize = 25 + pulse * 40;

  return (
    <div style={{
      position: 'absolute',
      width: 100,
      height: 100,
      transform: `scale(${scale})`,
      opacity,
    }}>
      <div style={{
        width: 100,
        height: 100,
        borderRadius: '50%',
        background: `radial-gradient(circle, ${color}dd 0%, ${color}88 50%, ${color}33 100%)`,
        boxShadow: `0 0 ${glowSize}px ${color}, inset 0 0 20px ${color}44`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '24px',
        fontWeight: 700,
        color: '#ffffff',
        textShadow: `0 2px 4px rgba(0,0,0,0.5)`,
      }}>
        {label}
      </div>
      {active && progressOpacity > 0 && (
        <AbsoluteFill style={{
          borderRadius: '50%',
          background: `conic-gradient(${color} ${progress * 360}deg, transparent 0)`,
          opacity: progressOpacity,
          mixBlendMode: 'screen',
        }} />
      )}
    </div>
  );
};
