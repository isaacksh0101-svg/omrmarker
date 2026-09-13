import type { ComponentType, ReactNode, SVGProps } from 'react';

interface Props {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  description?: string;
  right?: ReactNode;
}

// 사이드바 메뉴에 대응하는 각 화면 최상단에 똑같은 모양(아이콘 + 제목)을 쓰기 위한 공용 헤더.
export function PageHeader({ icon: Icon, title, description, right }: Props) {
  return (
    <div className="animate-fade-in-up flex items-center gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent-ink">
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-0.5 text-xs text-ink-soft">{description}</p>}
      </div>
      {right}
    </div>
  );
}
