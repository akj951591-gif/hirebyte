import { useEffect, useRef, type ReactNode } from 'react';
import { VideoOff } from 'lucide-react';
import { cn } from './cn';

export interface VideoPanelProps {
  label: string;
  /** Live stream to render. When absent, `placeholder` is shown. */
  stream?: MediaStream | null;
  /** Status badge or other overlay content for the top-right corner. */
  status?: ReactNode;
  placeholder?: ReactNode;
  mirrored?: boolean;
  className?: string;
}

export function VideoPanel({ label, stream, status, placeholder, mirrored = false, className }: VideoPanelProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = stream ?? null;
    if (stream) void el.play().catch(() => undefined);
  }, [stream]);

  return (
    <figure className={cn('relative overflow-hidden rounded-lg bg-ink/90', className)}>
      <div className="aspect-video w-full">
        {stream ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            aria-label={label}
            className={cn('h-full w-full object-cover', mirrored && '-scale-x-100')}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-ink-inverse/80">
            {placeholder ?? (
              <>
                <VideoOff className="h-6 w-6" aria-hidden />
                <span>No video</span>
              </>
            )}
          </div>
        )}
      </div>
      <figcaption className="absolute bottom-2 left-2 rounded bg-ink/70 px-2 py-0.5 text-xs font-medium text-ink-inverse">
        {label}
      </figcaption>
      {status && <div className="absolute right-2 top-2">{status}</div>}
    </figure>
  );
}
