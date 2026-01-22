import React from 'react';
import {useCurrentFrame, useVideoConfig, interpolate, spring} from 'remotion';

interface Particle {
  id: number;
  x: number;
  y: number;
  size: number;
  speed: number;
  delay: number;
}

export const ParticleBackground: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();

  const particles: Particle[] = Array.from({length: 50}, (_, i) => ({
    id: i,
    x: Math.random() * width,
    y: Math.random() * height,
    size: 2 + Math.random() * 3,
    speed: 20 + Math.random() * 40,
    delay: Math.random() * 2,
  }));

  return (
    <>
      {particles.map((particle) => {
        const startFrame = particle.delay * fps;
        const opacity = interpolate(frame, [startFrame, startFrame + 30], [0, 0.5], {extrapolateRight: 'clamp'});
        const yOffset = ((frame - startFrame) * particle.speed) % (height + 100) - 50;
        const y = (particle.y + yOffset) % (height + 100) - 50;
        
        const pulseOpacity = opacity * (0.3 + 0.2 * Math.sin((frame / 30 + particle.id) * Math.PI * 2));

        return (
          <div
            key={particle.id}
            style={{
              position: 'absolute',
              left: particle.x,
              top: y,
              width: particle.size,
              height: particle.size,
              borderRadius: '50%',
              background: `rgba(0, 245, 255, ${pulseOpacity})`,
              boxShadow: `0 0 ${particle.size * 2}px rgba(0, 245, 255, ${pulseOpacity * 0.5})`,
            }}
          />
        );
      })}
    </>
  );
};
