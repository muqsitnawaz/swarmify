import React from 'react';
import {interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {colors} from '../styles/colors';

interface SyncAnimationProps {
  type: 'push' | 'pull';
  startFrame?: number;
}

export const SyncAnimation: React.FC<SyncAnimationProps> = ({type, startFrame = 0}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const progress = interpolate(
    frame,
    [startFrame, startFrame + 45, startFrame + 90],
    [0, 1, 0],
    {extrapolateRight: 'clamp'}
  );

  const arrowOpacity = progress > 0 && progress < 1 ? 1 : 0;

  const isPush = type === 'push';

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 60,
      fontSize: 80,
    }}>
      <div style={{
        width: 120,
        height: 120,
        borderRadius: 20,
        background: colors.background.accent,
        border: `2px solid ${colors.background.accent}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: `0 0 ${30 + progress * 20}px ${colors.git.orange}44`,
      }}>
        <span style={{color: colors.text.primary}}>💻</span>
      </div>

      <div style={{
        fontSize: 60,
        color: colors.glow.cyan,
        opacity: arrowOpacity,
        transform: isPush ? `rotate(${progress * 360}deg)` : `rotate(-${progress * 360}deg)`,
      }}>
        {isPush ? '→' : '←'}
      </div>

      <div style={{
        width: 120,
        height: 120,
        borderRadius: 20,
        background: colors.git.black,
        border: `2px solid ${colors.git.orange}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: `0 0 ${30 + progress * 20}px ${colors.git.orange}44`,
      }}>
        <svg width={60} height={60} viewBox="0 0 16 16" fill={colors.git.orange}>
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55.17.55.38 0 .19-.01.82-.01 1.49-2.18.38-3.65-1.09-4.26-.63-.52-1.52-.72-2.19-.18-.66.1-1.12.41-1.12.83 0 .42.34.83.93 1.11 1.58.18.28.4.57.54.78.82.08.09.21.19.43.36.52.15.15.21.25.46.24.55-.01.09-.12.31-.29.57-.2.26-.46-.39-.66-.41-.4-.41-.67-.07-.2.24-.35-.6-.63-.43-.17-.07-.3-.13-.34-.27-.04-.09.03-.18.08-.27.12-.23.23-.55.3-.75.12-.31.25-.5.6-.85.08-.16.22-.38.38-.63.47-.25.09-.52.14-.79.14-.5 0-1.07-.15-1.56-.6-.5-.45-.63-.54-1.34-.28-1.83.14-.41.48-1.4 1.4-1.48.49-.08.98-.28 1.52-.7.16-.12.35-.17.71-.17-1.38 0-2.05.66-2.32 1.47-.15.42-.48.7-1.08.7-.73 0-1.37-.44-1.56-.68-.2-.25-.31-.6-.5-1.09-.19-.48-.25-1.05-.25-1.66 0-1.56 1.04-2.91 2.42-3.57.5-.22 1.05-.35 1.63-.35 2.53 0 4.64 2.18 6.16 5.31 2.39-1.6 3.96-4.12 3.96-6.82 0-1.3-.25-2.57-.7-3.72-.21-.57-.47-1.13-.79-1.66-.31-.54-.64-1.06-1-1.57-.36-.51-.7-1-1.04-1.56-.34-.56-.63-1.15-.89-1.77-.26-.62-.49-1.26-.68-1.92-.19-.65-.32-1.33-.32-2.02 0-2.16 1.45-3.97 3.52-4.55.53-.14 1.1-.2 1.68-.2.78 0 1.48.49 2.8 1.36 3.85.89.08 1.63.29 2.41.62.76.34 1.53.73 2.38 1.18.86.46 1.82.97 2.83 1.53.5.28 1.04.46 1.62.56.59.09 1.19.16 1.82.16 1.57 0 2.83-.4 3.81-1.18.49-.39.89-.86 1.25-1.37 1.72-.51.86-1.07 1.57-1.69 2.1-.6.53-1.27.93-2.01 1.07-.74.14-1.52.2-2.33.2-1.69 0-3.06-.56-4.08-1.67-.51-.55-.93-1.17-1.25-1.87-.32-.69-.57-1.44-.75-2.22-.18-.78-.26-1.6-.26-2.47 0-1.61.35-3.09.99-4.38.65-1.3 1.52-2.14 2.57-2.56.53-.21 1.09-.3 1.68-.3.86 0 1.61-.28 3.01-.84 4.21-.56 1.19-1.38 2.02-2.42 2.46-.51.22-1.06.34-1.64.34-.58 0-1.13-.08-1.64-.25-.52-.16-.98-.42-1.39-.75-.4-.33-.73-.7-1.02-1.1-.29-.4-.54-.82-.76-1.25-.23-.44-.43-.89-.62-1.35-.19-.45-.29-.91-.29-1.41 0-1.36.42-2.5 1.26-3.4.84-.89 1.4-1.4 2.36-1.54.49-.07.98-.1 1.49-.1.64 0 1.51-.32 2.8-.93 3.87-.62 1.07-1.48 1.81-2.56 2.18-.53.18-1.09.28-1.67.28-.6 0-1.16-.09-1.68-.28-.51-.18-.96-.47-1.36-.79-.4-.32-.73-.69-1.02-1.09-.29-.4-.54-.82-.76-1.25-.23-.43-.42-.89-.62-1.35-.19-.45-.29-.91-.29-1.41z"/>
        </svg>
      </div>
    </div>
  );
};
