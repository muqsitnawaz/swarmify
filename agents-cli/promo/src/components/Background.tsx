import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {colors} from '../styles/colors';

export const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();

  const gradientAngle = interpolate(frame, [0, durationInFrames], [0, 360], {extrapolateRight: 'clamp'});

  const ambientPulse = interpolate(
    frame % 90,
    [0, 45],
    [0.3, 0.6],
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
          radial-gradient(circle at 20% 30%, ${colors.glow.cyan}18 0%, transparent 50%),
          radial-gradient(circle at 80% 70%, ${colors.glow.purple}18 0%, transparent 50%),
          radial-gradient(circle at 50% 50%, ${colors.glow.blue}12 0%, transparent 60%),
          radial-gradient(circle at 30% 80%, ${colors.glow.pink}12 0%, transparent 60%)
        `,
        opacity: ambientPulse,
        mixBlendMode: 'screen',
      }} />
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: 'radial-gradient(circle at 1px 1px, #ffffff0a 1px, transparent 0)',
        backgroundSize: '40px 40px',
        opacity: 0.1,
      }} />
    </AbsoluteFill>
  );
};
