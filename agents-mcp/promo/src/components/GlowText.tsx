import React from 'react';
import {interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {colors} from '../styles/colors';

interface GlowTextProps {
  children: React.ReactNode;
  color?: string;
  delay?: number;
  size?: number;
}

export const GlowText: React.FC<GlowTextProps> = ({children, color = colors.glow.cyan, delay = 0, size = 1}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const startFrame = delay * fps;

  const springConfig = {damping: 200, stiffness: 100, mass: 1};
  const scale = spring({frame: frame - startFrame, fps, config: springConfig});
  const opacity = interpolate(frame, [startFrame, startFrame + 15], [0, 1], {extrapolateRight: 'clamp'});
  
  const glowPulse = interpolate(
    frame,
    [startFrame + 20, startFrame + 20 + 60, startFrame + 20 + 120],
    [1, 0.6, 1],
    {extrapolateRight: 'clamp'}
  );

  return (
    <div style={{
      opacity,
      transform: `scale(${scale})`,
      textShadow: `0 0 ${glowPulse * 30}px ${color}, 0 0 ${glowPulse * 60}px ${color}`,
      fontSize: `${size}em`,
      fontWeight: 700,
      color: '#ffffff',
      textAlign: 'center',
      letterSpacing: '0.02em',
    }}>
      {children}
    </div>
  );
};
