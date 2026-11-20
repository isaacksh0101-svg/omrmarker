import { useEffect, useRef, useState, type ReactNode } from 'react';
import { UserGuideContent } from '../pages/teacher/UserGuidePage';

export type DocumentKey = 'data' | 'terms' | 'guide';

const DOCUMENT_TITLES: Record<DocumentKey, string> = {
  data: 'ScoreLab 데이터 처리 및 개인정보 보호 안내',
  terms: '교사용 ScoreLab 소프트웨어 이용조건',
  guide: 'ScoreLab 사용설명서',
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line pt-5 first:border-0 first:pt-0">
      <h3 className="text-base font-extrabold text-ink">{title}</h3>
      <div className="mt-2 space-y-2 text-sm leading-7 text-ink-soft">{children}</div>
    </section>
  );
}

function DataGuide() {
  return (
    <div className="space-y-6">
      <p className="rounded-xl bg-accent-soft px-4 py-3 text-sm leading-7 text-accent-ink">
        ScoreLab은 학생 데이터를 개발자 서버에 수집하지 않는 로컬 설치형 프로그램입니다. 학생 데이터는
        ScoreLab을 실행하는 교사 PC에 저장됩니다.
      </p>
      <Section title="1. 목적과 역할">
        <p>ScoreLab은 시험 작성·실시·채점, 문항·성취기준별 분석과 학습 피드백을 지원합니다.</p>
        <p>학교 교육활동에서 학생 정보를 처리하는 주체는 해당 학교이고 담당 교사는 학교의 관리·감독 아래 프로그램을 사용합니다. 개발자 isaacksh0101은 프로그램 제공과 제품지원만 담당하며 학생 데이터를 보유하거나 원격으로 열람하지 않습니다.</p>
      </Section>
      <Section title="2. 처리하는 데이터와 보유기간">
        <ul className="list-disc space-y-1 pl-5">
          <li>학생 명단: 번호(필수), 이름(선택)</li>
          <li>시험 참여: 참여·시작·제출시각, 진행상태, 추가시간과 재참여 상태</li>
          <li>답안과 결과: 선택·단답형 답안, 정오답, 점수와 문항별 소요시간</li>
          <li>이의 제기: 단답형·서술형 채점에 대해 학생이 적은 이유와 처리 상태</li>
          <li>학습과 감독 기록: 화면 필기 획, 화면 이탈 유형·시각과 강제 종료 사유</li>
        </ul>
        <p>학생의 응시·답안·점수·소요시간·필기·화면 이탈 기록은 해당 학기 말까지 보유하고 담당 교사가 전체·선택 학생 또는 학년도별 삭제기능으로 삭제합니다. 학생 이름은 입력하지 않고 번호만 사용할 수 있습니다.</p>
      </Section>
      <Section title="3. 저장 위치와 외부 전송">
        <p>학생 데이터, 시험자료와 설정은 최초 실행 때 사용자가 선택한 교사 PC 폴더에 저장됩니다. 환경설정에서 현재 경로를 확인할 수 있습니다.</p>
        <p>학생의 번호·이름·답안·점수·필기·화면 이탈 기록은 개발자 서버나 Gemini API로 전송되지 않습니다.</p>
        <p>교사가 AI 기능을 실행하면 개인정보가 없는 빈 시험지·정답지, 교과·학년군과 성취기준 정보가 Google Gemini API로 HTTPS 전송될 수 있습니다. Upstage Document Parse 옵션을 선택하면 빈 시험지가 Upstage API에도 전송됩니다. 학생 개인정보가 포함된 문서를 외부 AI API에 업로드하면 안 됩니다.</p>
      </Section>
      <Section title="4. 네트워크와 보호조치">
        <p>학생은 교사 PC와 같은 네트워크에서 접속합니다. 교사 로그인과 관리기능은 해당 교사 PC의 localhost에서만 허용하고 학생 세션에는 무작위 접근 토큰을 사용합니다.</p>
        <p>학생 기기와 교사 PC 사이의 통신에는 현재 HTTPS가 적용되지 않습니다. ScoreLab은 교사가 선택한 네트워크와 같은 서브넷의 접속만 허용합니다. 학교 관리 내부망을 선택하고 교사 PC 계정·비밀번호·방화벽과 저장장치를 보호해야 합니다.</p>
      </Section>
      <Section title="5. 삭제와 백업">
        <p>`학생 관리 &gt; 선택한 학습 데이터 삭제` 또는 환경설정의 학년도별 삭제를 실행하면 해당 범위의 응시·답안·점수·시간·필기·화면 이탈 기록이 삭제되고 시험지와 명단은 유지됩니다.</p>
        <p>내보낸 백업, 로그, 시험 이미지와 복원용 `.bak` 사본은 자동으로 모두 삭제되지 않을 수 있습니다. 사용 교사 또는 학교가 필요한 기간 보관하고 직접 점검·삭제해야 합니다. 저장 위치를 바꾼 경우 변경 전 폴더도 확인해야 합니다.</p>
      </Section>
      <Section title="6. 학생·보호자의 요청">
        <p>학생 또는 보호자는 열람·정정·삭제·처리정지가 필요한 경우 ScoreLab을 사용한 담당 교사에게 구두 또는 학교가 허용한 연락수단으로 요청할 수 있습니다. 필요하면 학교 과학정보부가 지원합니다.</p>
        <p>개발자는 학생 데이터를 보유하지 않으므로 학생 데이터 요청을 직접 처리할 수 없습니다. 제품 설치·오류 문의와 학생 데이터 요청을 구분해 주세요.</p>
      </Section>
      <Section title="7. 만 14세 미만 학생과 시험 규칙">
        <p>학생 회원가입은 없지만 만 14세 미만 학생의 번호와 학습기록이 처리될 수 있습니다. 담당 교사는 시험 전에 처리 항목·목적·보유기간, 화면 이탈 규칙과 문의 방법을 이해하기 쉽게 안내합니다.</p>
        <p>화면 이탈은 시험을 강제 제출할 수 있으므로 오탐이나 불가피한 상황은 담당 교사가 확인해 재참여 여부를 판단합니다.</p>
      </Section>
      <Section title="8. 문의와 변경">
        <p>제품 설치·오류·업데이트: <a className="font-bold text-accent-ink underline" href="mailto:isaacksh0101@sen.go.kr">isaacksh0101@sen.go.kr</a></p>
        <p>변경내역·장애 공지: <a className="font-bold text-accent-ink underline" href="https://github.com/isaacksh0101-svg/omrmarker" target="_blank" rel="noreferrer">ScoreLab GitHub 저장소</a></p>
        <p>시행일: 2026년 9월 21일</p>
      </Section>
    </div>
  );
}

function Terms() {
  return (
    <div className="space-y-6">
      <Section title="제1조 목적">
        <p>이 이용조건은 isaacksh0101이 제공하는 로컬 설치형 수업·평가 지원 소프트웨어 ScoreLab의 이용조건과 배포자·교사 이용자의 역할을 정합니다.</p>
      </Section>
      <Section title="제2조 프로그램의 성격">
        <p>ScoreLab은 시험 작성·실시·채점과 결과 분석을 지원하며, 학생 데이터는 교사 PC에 저장되고 배포자의 중앙 서버로 전송되지 않습니다.</p>
        <p>학교 공식 행정시스템과 직접 연계되지 않으며 결과를 자동으로 학교생활기록부 등에 반영하지 않습니다. 학생 결과 분석은 교사 PC에서 정해진 계산 기준에 따라 처리되며 외부 AI가 학생 정보를 분석하지 않습니다.</p>
        <p>외부 AI는 교사가 올린 빈 시험지·정답지의 문서 또는 이미지를 온라인 시험 형식으로 추출·변환하는 보조기능에만 사용됩니다. 교사는 변환 결과를 원본과 비교해 확인·수정한 뒤 사용합니다.</p>
      </Section>
      <Section title="제3조 이용 및 배포 조건">
        <ul className="list-disc space-y-1 pl-5">
          <li>프로그램은 무료로 이용할 수 있습니다.</li>
          <li>비상업적 목적에 한해 설치파일을 재배포할 수 있습니다.</li>
          <li>비상업적 목적에 한해 소스코드를 수정하고 수정본을 재배포할 수 있습니다.</li>
          <li>프로그램과 수정본을 판매하거나 유료 상품·서비스의 일부로 제공하는 등 상업적으로 이용할 수 없습니다.</li>
          <li>오픈소스 구성요소에는 각 구성요소의 라이선스가 적용됩니다.</li>
        </ul>
      </Section>
      <Section title="제4조 학교와 교사의 데이터 관리">
        <p>학교는 교육활동 중 처리되는 학생 정보의 개인정보처리자이고 담당 교사는 학교의 관리·감독 아래 프로그램을 사용합니다.</p>
        <p>교사는 필요한 최소정보만 입력하고, 시험 전에 데이터 처리와 화면 이탈 규칙을 알리며, 해당 학기 말에 전체·선택 학생 또는 학년도별 기능으로 학습 데이터를 삭제합니다. 학생·보호자의 요청은 담당 교사가 접수하고 필요한 경우 과학정보부의 지원을 받습니다.</p>
      </Section>
      <Section title="제5조 네트워크와 기기 보호">
        <p>학교 관리 내부망에서만 사용하고 공개·게스트 Wi-Fi에서는 사용하지 않습니다. 교사 PC 계정, ScoreLab 비밀번호, 방화벽, 저장장치와 시험 접속정보를 보호해야 합니다.</p>
      </Section>
      <Section title="제6조 외부 AI 시험지 변환 기능">
        <p>Gemini와 Upstage Document Parse는 교사가 올린 시험지 문서 또는 이미지에서 문항을 추출해 온라인 시험 형식으로 옮기는 선택기능입니다. 개인정보가 없는 빈 시험지·정답지만 사용해야 하며, 변환된 문항·보기·정답 및 성취기준 후보는 교사가 원본과 비교해 확인·수정해야 합니다.</p>
        <p>학생 명단, 학생이 작성한 답안, 점수, 문항별 소요시간, 필기, 화면 이탈 기록과 시험 결과는 외부 AI에 전송되거나 AI 분석에 사용되지 않습니다. 각 교사 또는 학교는 자신의 API 키와 이용료를 부담·관리합니다.</p>
      </Section>
      <Section title="제7조 시험 운영과 결과">
        <p>교사는 대상 학생과 학교 환경에 맞게 시험을 운영하고 자동 채점 결과를 확인합니다. 네트워크·기기 문제나 화면 이탈 오탐이 발생한 경우 학생에게 불리하지 않도록 재참여 등 적절한 조치를 판단합니다.</p>
      </Section>
      <Section title="제8조 백업과 이용 종료">
        <p>백업에는 학생 정보가 포함될 수 있으므로 학교가 허용한 저장장치에서 관리합니다. 사용 종료나 PC 교체 시 데이터 폴더, 이전 저장 폴더, 내보낸 백업과 학생 기기의 사이트 데이터를 점검·삭제합니다.</p>
      </Section>
      <Section title="제9조 업데이트·지원·책임">
        <p>배포자는 오류 수정과 보안 개선을 위해 프로그램을 업데이트할 수 있으며 중요한 변경은 GitHub 저장소에 게시합니다. 이용자는 설치·업데이트 전에 변경내역을 확인합니다.</p>
        <p>프로그램과 외부 AI의 시험지 추출·변환 결과가 모든 환경에서 오류 없이 동작하거나 항상 정확함을 보증하지는 않습니다. 이 문구는 관련 법령상 배제할 수 없는 배포자의 책임을 면제하지 않습니다.</p>
        <p>제품 문의: <a className="font-bold text-accent-ink underline" href="mailto:isaacksh0101@sen.go.kr">isaacksh0101@sen.go.kr</a> · 답변 목표: 평일 기준 7일 이내</p>
        <p>시행일: 2026년 9월 21일</p>
      </Section>
    </div>
  );
}

// 데이터 처리 안내·이용조건은 법적으로 끝까지 확인시킬 필요가 있지만, 사용설명서는
// 목차로 바로 이동해 필요한 부분만 찾아보는 참고 문서라 끝까지 스크롤해야 닫히는 제약을
// 걸지 않는다.
const REQUIRES_FULL_READ: Record<DocumentKey, boolean> = { data: true, terms: true, guide: false };

export function LegalDocumentModal({
  documentKey,
  onClose,
  closeLabel = '닫기',
}: {
  documentKey: DocumentKey;
  onClose: () => void;
  closeLabel?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const requiresFullRead = REQUIRES_FULL_READ[documentKey];
  const [readToEnd, setReadToEnd] = useState(!requiresFullRead);
  const canClose = !requiresFullRead || readToEnd;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() => {
      const element = scrollRef.current;
      if (element && element.scrollHeight <= element.clientHeight + 2) setReadToEnd(true);
      element?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  function updateReadState() {
    const element = scrollRef.current;
    if (element && element.scrollTop + element.clientHeight >= element.scrollHeight - 8) setReadToEnd(true);
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-[#10234a]/55 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && canClose) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="legal-document-title"
        className="flex h-[100dvh] w-full flex-col overflow-hidden bg-white shadow-2xl sm:h-[min(88vh,900px)] sm:max-w-3xl sm:rounded-[1.75rem] sm:border sm:border-blue-100"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            if (canClose) onClose();
          }
        }}
      >
        <header className="shrink-0 border-b border-line px-5 py-4 sm:px-7">
          <p className="text-xs font-bold text-accent-ink">ScoreLab</p>
          <h2 id="legal-document-title" className="mt-1 text-lg font-extrabold tracking-tight text-ink sm:text-xl">
            {DOCUMENT_TITLES[documentKey]}
          </h2>
          {requiresFullRead && (
            <p className="mt-1 text-xs text-ink-soft">아래 문서를 끝까지 확인하면 닫을 수 있습니다.</p>
          )}
        </header>

        <div
          ref={scrollRef}
          data-testid="legal-document-scroll"
          tabIndex={0}
          onScroll={updateReadState}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 outline-none sm:px-7"
        >
          {documentKey === 'data' ? <DataGuide /> : documentKey === 'terms' ? <Terms /> : <UserGuideContent />}
          <div aria-hidden="true" className="h-1" />
        </div>

        <footer className="shrink-0 border-t border-line bg-white px-5 py-3 sm:px-7">
          <div className="flex items-center justify-between gap-3">
            {requiresFullRead ? (
              <p aria-live="polite" className={`text-xs font-bold ${readToEnd ? 'text-good' : 'text-ink-soft'}`}>
                {readToEnd ? '문서를 끝까지 확인했습니다.' : '아래로 스크롤해 문서를 끝까지 확인해주세요.'}
              </p>
            ) : (
              <span />
            )}
            <button
              ref={closeRef}
              data-testid="legal-document-close"
              type="button"
              disabled={!canClose}
              onClick={onClose}
              className="shrink-0 rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-soft"
            >
              {closeLabel}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

export function LegalFooter() {
  const [openDocument, setOpenDocument] = useState<DocumentKey | null>(null);

  return (
    <>
      <footer className="border-t border-blue-100/80 bg-white/80 px-4 py-4 text-center text-[11px] text-ink-soft backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5">
          <button data-testid="open-data-guide" type="button" className="font-bold hover:text-accent-ink hover:underline" onClick={() => setOpenDocument('data')}>
            데이터 처리 및 개인정보 보호 안내
          </button>
          <button data-testid="open-terms" type="button" className="font-bold hover:text-accent-ink hover:underline" onClick={() => setOpenDocument('terms')}>
            교사용 이용조건
          </button>
          <button data-testid="open-user-guide" type="button" className="font-bold hover:text-accent-ink hover:underline" onClick={() => setOpenDocument('guide')}>
            사용설명서
          </button>
          <a href="mailto:isaacksh0101@sen.go.kr" className="font-bold hover:text-accent-ink hover:underline">제품 문의</a>
        </div>
        <p className="mt-1.5">© 2026 isaacksh0101 · 학생 데이터 요청은 담당 교사 또는 해당 학교에 문의하세요.</p>
      </footer>
      {openDocument && <LegalDocumentModal documentKey={openDocument} onClose={() => setOpenDocument(null)} />}
    </>
  );
}
