import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import {colors} from '../styles/colors';

interface FeatureCardProps {
  title: string;
  description: string;
  example: string;
  color: string;
  delay: number;
  startFrame?: number;
}

export const FeatureCard: React.FC<FeatureCardProps> = ({
  title,
  description,
  example,
  color,
  delay,
  startFrame = 0
}) => {
  const frame = useCurrentFrame();
  const cardStart = startFrame + delay * 10;

  const opacity = interpolate(frame, [cardStart, cardStart + 20], [0, 1], {extrapolateRight: 'clamp'});
  const translateY = interpolate(frame, [cardStart, cardStart + 20], [40, 0], {extrapolateRight: 'clamp'});

  return (
    <div style={{
      width: 360,
      padding: 24,
      background: `${colors.background.accent}cc`,
      borderRadius: 16,
      border: `1px solid ${color}44`,
      boxShadow: `0 20px 50px rgba(0,0,0,0.4), 0 0 30px ${color}22`,
      opacity,
      transform: `translateY(${translateY}px)`,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginBottom: 16,
      }}>
        <div style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          background: `${color}33`,
          border: `1px solid ${color}66`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 20,
        }}>
          ⚡
        </div>
        <div style={{
          fontSize: 18,
          fontWeight: 700,
          color: colors.text.primary,
        }}>
          {title}
        </div>
      </div>

      <div style={{
        fontSize: 15,
        color: colors.text.secondary,
        marginBottom: 16,
        lineHeight: 1.5,
      }}>
        {description}
      </div>

      <div style={{
        padding: '12px 16px',
        background: `${colors.background.dark}aa`,
        borderRadius: 8,
        border: `1px solid ${color}33`,
        fontFamily: 'monospace',
        fontSize: 13,
        color: colors.glow.cyan,
      }}>
        {example}
      </div>
    </div>
  );
};
