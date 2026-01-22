import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';

interface TypeWriterProps {
  text: string;
  charsPerSecond?: number;
  style?: React.CSSProperties;
}

export const TypeWriter: React.FC<TypeWriterProps> = ({text, charsPerSecond = 15, style}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const charsToShow = Math.floor((frame * charsPerSecond) / fps);
  const displayText = text.slice(0, charsToShow);
  const showCursor = frame % Math.floor(fps / 2) < Math.floor(fps / 4);

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
