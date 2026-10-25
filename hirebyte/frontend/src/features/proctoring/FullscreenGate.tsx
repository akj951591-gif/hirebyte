import { Maximize } from 'lucide-react';
import { Button } from '@/components/Button';

/** Blocks the interview until the candidate is in full screen (entering needs a click). */
export function FullscreenGate({ onEnter }: { onEnter: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/90 p-4" role="dialog" aria-modal="true" aria-labelledby="fullscreen-title">
      <div className="card w-full max-w-md p-6 text-center">
        <Maximize className="mx-auto h-8 w-8 text-brand" aria-hidden />
        <h2 id="fullscreen-title" className="mt-3 text-lg font-semibold text-ink">
          Full screen is required
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          The interview runs in full screen. If you leave full screen, the interview ends and your saved answers are submitted.
        </p>
        <Button className="mt-5 w-full" size="lg" onClick={onEnter} icon={<Maximize className="h-4 w-4" aria-hidden />}>
          Enter full screen
        </Button>
      </div>
    </div>
  );
}
