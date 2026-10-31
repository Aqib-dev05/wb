import { useEffect } from 'react';
import { GRID_SIZE, PAPER } from '../../canvas/constants.js';

/**
 * The surface Fabric renders into. The dot grid is plain CSS that follows the viewport transform,
 * so it feels infinite without drawing thousands of dots on the canvas.
 */
export function CanvasStage({ hostRef, controller }) {
  useEffect(() => {
    if (!controller) return undefined;
    const host = hostRef.current;
    return controller.on('viewport', ({ zoom, x, y }) => {
      let size = GRID_SIZE * zoom;
      while (size < 14) size *= 4; // thin the grid out when zoomed far away
      host.style.backgroundSize = `${size}px ${size}px`;
      host.style.backgroundPosition = `${x}px ${y}px`;
    });
  }, [controller, hostRef]);

  return (
    <div
      ref={hostRef}
      className="absolute inset-0 touch-none overflow-hidden"
      style={{
        backgroundColor: PAPER,
        backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(20, 22, 31, 0.2) 1px, transparent 0)',
        backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`,
      }}
    />
  );
}
