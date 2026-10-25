import { Alert } from '@/components/Alert';
import type { CandidateAlert } from './hooks/useCandidateAlerts';

/** Live reminders for the candidate while the camera or tab checks notice something. */
export function CandidateAlerts({ alerts }: { alerts: CandidateAlert[] }) {
  if (alerts.length === 0) return null;
  return (
    <div className="space-y-2" aria-live="assertive">
      {alerts.map((alert) => (
        <Alert key={alert.type} tone="warning" title="Heads up">
          {alert.message}
        </Alert>
      ))}
    </div>
  );
}
