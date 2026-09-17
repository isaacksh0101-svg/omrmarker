import type { SessionStatus } from '../types';

export type Tone = 'neutral' | 'good' | 'warn' | 'danger';

const STATUS_META: Record<SessionStatus, { label: string; tone: Tone; dot: string }> = {
  joined: { label: '참여함(대기중)', tone: 'neutral', dot: 'bg-ink-soft' },
  in_progress: { label: '응시 중', tone: 'good', dot: 'bg-good' },
  submitted: { label: '제출 완료', tone: 'neutral', dot: 'bg-ink-soft' },
  force_submitted: { label: '강제 종료됨', tone: 'danger', dot: 'bg-danger' },
  disqualified: { label: '실격', tone: 'danger', dot: 'bg-danger' },
};

const NOT_JOINED_META = { label: '입장 전', tone: 'neutral' as Tone, dot: 'bg-line' };

// force_submitted면 왜 종료됐는지(교사가 직접 종료했는지, 화면 이탈이 감지돼 자동으로
// 종료됐는지)까지 라벨에 같이 보여준다 - 학생이 "소명"하러 왔을 때 교사가 근거를 바로 볼 수 있게.
export function statusMeta(status: SessionStatus | null, disqualifyReason?: string | null) {
  if (!status) return NOT_JOINED_META;
  if (status === 'force_submitted' && disqualifyReason === 'screen_leave') {
    return { label: '자동 종료됨(화면 이탈 감지)', tone: 'danger' as Tone, dot: 'bg-danger' };
  }
  if (status === 'force_submitted' && disqualifyReason === 'teacher_manual') {
    return { label: '강제 종료됨(교사)', tone: 'danger' as Tone, dot: 'bg-danger' };
  }
  return STATUS_META[status];
}
