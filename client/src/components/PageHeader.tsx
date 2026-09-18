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
    <div className="animate-fade-in-up flex items-center gap-3.5">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#075df5_0%,#08b9e8_100%)] text-white shadow-[0_7px_18px_rgba(7,93,245,0.22)]">
        <Icon className="h-[22px] w-[22px]" />
      </span>
      <div className="min-w-0 flex-1">
        <h1 className="text-[1.7rem] font-bold tracking-[-0.035em] text-ink">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-ink-soft">{description}</p>}
      </div>
      {right}
    </div>
  );
}
