import { useCallback, useEffect, useRef, useState } from 'react';
import { CANDIDATE_ALERTS, type ObservationType } from '../observations';

export interface CandidateAlert {
  type: ObservationType;
  message: string;
}

/**
 * Live alerts for the candidate: raised when an observation starts to count and kept on screen for
 * `holdMs` after it stops, so a short one is still noticed. Reporting to the recruiter is separate.
 */
export function useCandidateAlerts(holdMs = 6000): { alerts: CandidateAlert[]; onLiveChange: (type: ObservationType, active: boolean) => void } {
  const [alerts, setAlerts] = useState<CandidateAlert[]>([]);
  const timers = useRef(new Map<ObservationType, number>());

  const onLiveChange = useCallback(
    (type: ObservationType, active: boolean) => {
      window.clearTimeout(timers.current.get(type));
      timers.current.delete(type);
      if (active) {
        setAlerts((cur) => [{ type, message: CANDIDATE_ALERTS[type] }, ...cur.filter((a) => a.type !== type)]);
        return;
      }
      timers.current.set(
        type,
        window.setTimeout(() => {
          timers.current.delete(type);
          setAlerts((cur) => cur.filter((a) => a.type !== type));
        }, holdMs),
      );
    },
    [holdMs],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((id) => window.clearTimeout(id));
  }, []);

  return { alerts, onLiveChange };
}
