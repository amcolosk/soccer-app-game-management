import { forwardRef, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import './SoccerPitchSurface.css';

interface SoccerPitchSurfaceProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  children: ReactNode;
  style?: CSSProperties;
}

export const SoccerPitchSurface = forwardRef<HTMLDivElement, SoccerPitchSurfaceProps>(function SoccerPitchSurface(
  { children, className, ...rest },
  ref,
) {
  const classes = ['soccer-pitch-surface', className].filter(Boolean).join(' ');

  return (
    <div ref={ref} className={classes} {...rest}>
      <div className="soccer-pitch-surface__markings" aria-hidden="true">
        <div className="soccer-pitch-surface__center-line" />
        <div className="soccer-pitch-surface__center-circle" />
        <div className="soccer-pitch-surface__center-spot" />
        <div className="soccer-pitch-surface__penalty-box soccer-pitch-surface__penalty-box--top" />
        <div className="soccer-pitch-surface__penalty-box soccer-pitch-surface__penalty-box--bottom" />
      </div>
      {children}
    </div>
  );
});
