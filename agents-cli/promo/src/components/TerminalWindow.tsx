import React from 'react';
import {AbsoluteFill} from 'remotion';
import {colors} from '../styles/colors';

interface TerminalWindowProps {
  children: React.ReactNode;
  width?: number;
  height?: number;
  title?: string;
}

export const TerminalWindow: React.FC<TerminalWindowProps> = ({
  children,
  width = 800,
  height = 500,
  title = 'Terminal'
}) => {
  return (
    <div style={{
      width,
      height,
      background: colors.background.terminal,
      borderRadius: 12,
      border: `1px solid ${colors.background.accent}`,
      boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 40px rgba(0,245,255,0.1)',
      overflow: 'hidden',
    }}>
      <div style={{
        height: 36,
        background: colors.background.accent,
        borderBottom: `1px solid ${colors.background.accent}`,
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        gap: 8,
      }}>
        <div style={{width: 12, height: 12, borderRadius: '50%', background: '#ff5f57'}} />
        <div style={{width: 12, height: 12, borderRadius: '50%', background: '#ffbd2e'}} />
        <div style={{width: 12, height: 12, borderRadius: '50%', background: '#28ca42'}} />
        <div style={{
          flex: 1,
          textAlign: 'center',
          color: colors.text.tertiary,
          fontSize: 13,
          fontWeight: 500,
        }}>
          {title}
        </div>
      </div>
      <div style={{
        padding: 20,
        fontFamily: 'monospace',
        fontSize: 14,
        lineHeight: 1.6,
        color: colors.text.terminal,
        overflow: 'auto',
      }}>
        {children}
      </div>
    </div>
  );
};
