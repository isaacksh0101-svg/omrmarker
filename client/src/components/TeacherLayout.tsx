import type { ReactNode } from 'react';
import { AuthGate } from './AuthGate';
import { TeacherNav } from './TeacherNav';
import { DataRetentionBanner } from './DataRetentionBanner';
import { PreviousStorageBanner } from './PreviousStorageBanner';
import { OnboardingGate } from './OnboardingGate';
import { InitialSetupGate } from './InitialSetupGate';

export function TeacherLayout({ children }: { children: ReactNode }) {
  return (
    <InitialSetupGate>
      <AuthGate>
        <OnboardingGate>
          <div className="flex min-h-screen bg-transparent">
            <TeacherNav />
            <main className="min-w-0 flex-1">
              <DataRetentionBanner />
              <PreviousStorageBanner />
              {children}
            </main>
          </div>
        </OnboardingGate>
      </AuthGate>
    </InitialSetupGate>
  );
}
