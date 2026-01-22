import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {colors} from '../styles/colors';
import {ParticleBackground} from './ParticleBackground';

export const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();

  const gradientAngle = interpolate(frame, [0, durationInFrames], [0, 360], {extrapolateRight: 'clamp'});

  const ambientPulse = interpolate(
    frame % 90,
    [0, 45],
    [0.4, 0.7],
    {extrapolateRight: 'clamp'}
  );

  return (
    <AbsoluteFill style={{
      background: `linear-gradient(${gradientAngle}deg, ${colors.background.dark} 0%, ${colors.background.light} 50%, ${colors.background.dark} 100%)`,
    }}>
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: `
          radial-gradient(circle at 20% 50%, ${colors.glow.purple}22 0%, transparent 50%),
          radial-gradient(circle at 80% 20%, ${colors.glow.cyan}22 0%, transparent 50%),
          radial-gradient(circle at 60% 80%, ${colors.glow.blue}22 0%, transparent 50%),
          radial-gradient(circle at 30% 80%, ${colors.glow.pink}22 0%, transparent 50%)
        `,
        opacity: ambientPulse,
        mixBlendMode: 'screen',
      }} />
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: 'radial-gradient(circle at 1px 1px, #ffffff11 1px, transparent 0)',
        backgroundSize: '40px 40px',
        opacity: 0.15,
      }} />
      <ParticleBackground />
    </AbsoluteFill>
  );
};
