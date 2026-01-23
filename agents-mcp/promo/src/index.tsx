import React from 'react';
import {Composition, registerRoot} from 'remotion';
import {Root} from './Root';

registerRoot(() => {
  return (
    <div>
      <Composition
        id="Root"
        component={Root}
        durationInFrames={1080}
        fps={30}
        width={1920}
        height={1080}
      />
    </div>
  );
});
