import { FlaskConical } from 'lucide-react';
import { featureFlags } from '@/config/featureFlags';

/** Always visible while the fixture transport is active, so fixture data is never mistaken for real data. */
export function FixtureBanner() {
  if (!featureFlags.useFixtures) return null;

  const reset = async () => {
    if (import.meta.env.VITE_USE_FIXTURES !== 'true') return; // lets the bundler drop the fixture chunk
    const { fixtureControls } = await import('@/api/client/mockTransport');
    fixtureControls.reset();
    window.location.assign('/');
  };

  return (
    <div className="no-print flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-warning-soft px-4 py-1.5 text-center text-xs text-warning">
      <span className="inline-flex items-center gap-1.5 font-semibold">
        <FlaskConical className="h-3.5 w-3.5" aria-hidden />
        Fixture mode
      </span>
      <span className="text-ink-muted">Sample data only. No backend, AI, camera streaming or recording service is connected.</span>
      <button type="button" onClick={reset} className="font-medium underline underline-offset-2 hover:text-ink">
        Reset demo data
      </button>
    </div>
  );
}
