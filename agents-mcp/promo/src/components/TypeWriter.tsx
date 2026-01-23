import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';

interface TypeWriterProps {
  text: string;
  charsPerSecond?: number;
  style?: React.CSSProperties;
  startFrame?: number;
}

export const TypeWriter: React.FC<TypeWriterProps> = ({text, charsPerSecond = 15, style, startFrame = 0}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const effectiveFrame = Math.max(0, frame - startFrame);
  const charsToShow = Math.floor((effectiveFrame * charsPerSecond) / fps);
  const displayText = text.slice(0, charsToShow);
  const showCursor = frame >= startFrame && effectiveFrame % Math.floor(fps / 2) < Math.floor(fps / 4);

  return (
    <span style={style}>
      {displayText}
      {showCursor && (
        <span style={{
          display: 'inline-block',
          width: '10px',
          height: '1.2em',
          backgroundColor: '#00f5ff',
          marginLeft: '2px',
          verticalAlign: 'middle',
        }} />
      )}
    </span>
  );
};
