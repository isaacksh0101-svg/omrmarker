import type { ReactNode } from 'react';
import { AuthGate } from './AuthGate';
import { TeacherNav } from './TeacherNav';
import { DataRetentionBanner } from './DataRetentionBanner';
import { PreviousStorageBanner } from './PreviousStorageBanner';

export function TeacherLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <div className="flex min-h-screen bg-transparent">
        <TeacherNav />
        <main className="min-w-0 flex-1">
          <DataRetentionBanner />
          <PreviousStorageBanner />
          {children}
        </main>
      </div>
    </AuthGate>
  );
}
