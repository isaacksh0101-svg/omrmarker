import type { ReactNode } from 'react';
import { TeacherNav } from './TeacherNav';

export function TeacherLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-bg">
      <TeacherNav />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
