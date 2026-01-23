import React from 'react';
import {interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {colors} from '../styles/colors';

interface CommandLine {
  text: string;
  color?: string;
  delay?: number;
}

interface CommandDisplayProps {
  lines: CommandLine[];
  prompt?: string;
}

export const CommandDisplay: React.FC<CommandDisplayProps> = ({lines, prompt = '$'}) => {
  const frame = useCurrentFrame();

  return (
    <div style={{
      fontFamily: 'monospace',
      fontSize: 14,
      lineHeight: 1.8,
    }}>
      {lines.map((line, idx) => {
        const startFrame = (line.delay || idx * 5) + 10;
        const opacity = interpolate(frame, [startFrame, startFrame + 10], [0, 1], {extrapolateRight: 'clamp'});

        return (
          <div key={idx} style={{
            opacity,
            marginBottom: 4,
          }}>
            <span style={{color: colors.glow.cyan, fontWeight: 600}}>{prompt} </span>
            <span style={{color: line.color || colors.text.terminal}}>{line.text}</span>
          </div>
        );
      })}
    </div>
  );
};

export const OutputLine: React.FC<{
  text: string;
  type?: 'keyword' | 'string' | 'number' | 'comment' | 'command' | 'success' | 'error' | 'path';
  startFrame?: number;
}> = ({text, type, startFrame = 0}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [startFrame, startFrame + 8], [0, 1], {extrapolateRight: 'clamp'});

  const colorMap = {
    keyword: colors.terminal.keyword,
    string: colors.terminal.string,
    number: colors.terminal.number,
    comment: colors.terminal.comment,
    command: colors.terminal.command,
    success: colors.terminal.success,
    error: colors.terminal.error,
    path: colors.terminal.path,
  };

  return (
    <div style={{
      opacity,
      color: type ? colorMap[type] : colors.text.terminal,
      marginBottom: 2,
    }}>
      {text}
    </div>
  );
};
