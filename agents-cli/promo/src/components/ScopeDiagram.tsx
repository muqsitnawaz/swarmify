import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import {colors} from '../styles/colors';

interface ScopeDiagramProps {
  startFrame?: number;
}

export const ScopeDiagram: React.FC<ScopeDiagramProps> = ({startFrame = 0}) => {
  const frame = useCurrentFrame();

  const userOpacity = interpolate(frame, [startFrame + 20, startFrame + 50], [0, 1], {extrapolateRight: 'clamp'});
  const projectOpacity = interpolate(frame, [startFrame + 60, startFrame + 90], [0, 1], {extrapolateRight: 'clamp'});
  const arrowOpacity = interpolate(frame, [startFrame + 100, startFrame + 130], [0, 1], {extrapolateRight: 'clamp'});

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 40,
    }}>
      <div style={{
        padding: '24px 32px',
        background: `${colors.background.accent}aa`,
        borderRadius: 16,
        border: `1px solid ${colors.glow.cyan}55`,
        opacity: userOpacity,
        boxShadow: `0 0 ${40}px ${colors.glow.cyan}22`,
      }}>
        <div style={{
          fontSize: 18,
          fontWeight: 700,
          color: colors.glow.cyan,
          marginBottom: 16,
        }}>
          User Scope
        </div>
        <div style={{
          fontSize: 14,
          color: colors.text.tertiary,
          marginBottom: 12,
          fontFamily: 'monospace',
        }}>
          ~/.claude/, ~/.codex/, ~/.gemini/
        </div>
        <div style={{
          fontSize: 15,
          color: colors.text.secondary,
          lineHeight: 1.5,
        }}>
          Available in <span style={{color: colors.glow.green, fontWeight: 600}}>all projects</span>
        </div>
      </div>

      <div style={{
        display: 'flex',
        justifyContent: 'center',
        opacity: arrowOpacity,
      }}>
        <div style={{
          fontSize: 40,
          color: colors.glow.purple,
        }}>
          ↔
        </div>
      </div>

      <div style={{
        padding: '24px 32px',
        background: `${colors.background.accent}aa`,
        borderRadius: 16,
        border: `1px solid ${colors.glow.purple}55`,
        opacity: projectOpacity,
        boxShadow: `0 0 ${40}px ${colors.glow.purple}22`,
      }}>
        <div style={{
          fontSize: 18,
          fontWeight: 700,
          color: colors.glow.purple,
          marginBottom: 16,
        }}>
          Project Scope
        </div>
        <div style={{
          fontSize: 14,
          color: colors.text.tertiary,
          marginBottom: 12,
          fontFamily: 'monospace',
        }}>
          ./.claude/, ./.codex/, ./.gemini/
        </div>
        <div style={{
          fontSize: 15,
          color: colors.text.secondary,
          lineHeight: 1.5,
        }}>
          <span style={{color: colors.glow.orange, fontWeight: 600}}>Project-specific</span> overrides
        </div>
      </div>
    </div>
  );
};
