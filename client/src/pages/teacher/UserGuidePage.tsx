import { Link } from 'react-router-dom';

const sections = [
  { id: 'start', label: '시작하기' },
  { id: 'roster', label: '학생 명단' },
  { id: 'exam', label: '시험지 만들기' },
  { id: 'ai', label: 'AI 불러오기' },
  { id: 'join', label: '학생 접속' },
  { id: 'monitor', label: '시험 감독' },
  { id: 'results', label: '결과와 리포트' },
  { id: 'storage', label: '저장·백업·삭제' },
  { id: 'trouble', label: '문제 해결' },
];

function GuideSection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 border-t border-line pt-6 first:border-0 first:pt-0">
      <h2 className="text-lg font-extrabold tracking-tight text-ink">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-7 text-ink-soft">{children}</div>
    </section>
  );
}

export function UserGuideContent() {
  return (
    <div className="space-y-7">
      <section className="rounded-xl bg-accent-soft px-4 py-4">
        <p className="text-sm leading-7 text-ink-soft">
          ScoreLab은 교사 PC에 데이터를 저장하고 학생이 같은 학교 내부 네트워크에서 접속하는
          수업·평가 지원 도구입니다. 아래 순서대로 준비하면 바로 사용할 수 있습니다.
        </p>
        <nav className="mt-4 flex flex-wrap gap-2" aria-label="사용설명서 목차">
          {sections.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className="rounded-lg border border-blue-100 bg-accent-soft px-3 py-1.5 text-xs font-bold text-accent-ink hover:border-blue-300"
            >
              {section.label}
            </a>
          ))}
        </nav>
      </section>

      <div className="space-y-7">
        <GuideSection id="start" title="1. 시작하기">
          <ol className="list-decimal space-y-1 pl-5">
            <li>ScoreLab을 실행하고 처음 사용할 데이터 저장 폴더를 선택합니다.</li>
            <li>교사용 비밀번호를 설정합니다.</li>
            <li>학생 관리에서 명단을 준비합니다.</li>
            <li>시험지 만들기에서 시험을 만들고 문항과 정답을 확인합니다.</li>
            <li>환경설정에서 학생 접속용 학교 내부 네트워크를 선택한 뒤 QR 또는 링크를 학생에게 제공합니다.</li>
          </ol>
          <p className="rounded-xl bg-warning/10 px-3 py-2 text-warning">
            공개·게스트 Wi-Fi가 아닌 학교가 관리하는 내부 네트워크에서 사용하세요.
          </p>
        </GuideSection>

        <GuideSection id="roster" title="2. 학생 명단 준비">
          <p><Link to="/roster" className="font-bold text-accent-ink underline">학생 관리</Link>에서 직접 추가하거나 Excel 양식을 내려받아 명단을 가져올 수 있습니다. 이름은 선택항목이며 출석번호만으로도 사용할 수 있습니다.</p>
          <ul className="list-disc space-y-1 pl-5">
            <li><b className="text-ink">명단 삭제</b>: 명단 행을 삭제합니다. 과거 학습 데이터는 별도로 남을 수 있습니다.</li>
            <li><b className="text-ink">선택한 학습 데이터 삭제</b>: 체크박스로 전체 또는 원하는 학생을 선택해 응시·답안·점수·문항별 시간·필기·화면 이탈 기록을 완전 삭제하고 명단은 유지합니다.</li>
          </ul>
        </GuideSection>

        <GuideSection id="exam" title="3. 시험지 만들기">
          <p><Link to="/" className="font-bold text-accent-ink underline">시험지 만들기</Link>에서 교과, 학년군, 제목, 제한시간과 시험 방식을 선택합니다.</p>
          <ul className="list-disc space-y-1 pl-5">
            <li><b className="text-ink">온라인 응시</b>: 학생 화면에 문제와 보기를 표시합니다.</li>
            <li><b className="text-ink">종이 시험지 + 마킹</b>: 학생은 종이 문제를 보고 화면에는 답만 표시합니다.</li>
          </ul>
          <p>문항, 보기, 배점, 정답과 성취기준을 확인하세요. 모든 문항에 정답이 있어야 시험지를 확정할 수 있습니다.</p>
        </GuideSection>

        <GuideSection id="ai" title="4. AI로 시험지 불러오기">
          <p><Link to="/settings" className="font-bold text-accent-ink underline">환경설정</Link>에서 교사 또는 학교의 Gemini API 키를 등록하면 시험지 사진·PDF의 문항 추출, 정답 입력과 성취기준 후보 제안을 사용할 수 있습니다.</p>
          <p className="rounded-xl bg-danger/5 px-3 py-2 text-danger">학생 이름·작성 답안·점수 등이 포함된 파일은 올리지 말고 개인정보가 없는 빈 시험지와 정답지만 사용하세요.</p>
          <p>AI 결과에는 오류가 있을 수 있으므로 원본과 비교해 교사가 수정한 뒤 사용합니다.</p>
        </GuideSection>

        <GuideSection id="join" title="5. 학생 접속">
          <ol className="list-decimal space-y-1 pl-5">
            <li>교사 PC와 학생 기기를 같은 내부 네트워크에 연결합니다.</li>
            <li>환경설정의 학생 접속 QR 또는 링크를 공유합니다.</li>
            <li>학생이 출석번호와 응시할 시험을 선택하고 대기합니다.</li>
            <li>교사는 `접속 학생 확인 후 시작`에서 번호와 인원을 확인하고 시험을 시작합니다.</li>
            <li>시험 시작과 동시에 새 학생의 입장이 마감됩니다. 기기를 바꿔야 하는 학생만 감독 화면에서 재참여를 허용합니다.</li>
          </ol>
          <p>Windows 공용(Public) 네트워크는 학생 접속이 차단됩니다. 접속이 안 되면 환경설정에서 학교 내부망 어댑터를 선택하고, 학교 AP의 기기간 통신과 Windows 방화벽 포트 4000을 확인하세요.</p>
        </GuideSection>

        <GuideSection id="monitor" title="6. 시험 감독">
          <p><Link to="/exam-monitor" className="font-bold text-accent-ink underline">시험 감독</Link>에서는 시작, 학생별 추가시간, 강제 제출, 되살리기, 전체 종료와 다시 열기를 사용할 수 있습니다.</p>
          <p>학생이 다른 탭·창으로 이동하거나 화면을 최소화하면 강제 제출될 수 있습니다. 오탐이나 기기 문제는 교사가 확인해 재참여 여부를 결정하세요.</p>
        </GuideSection>

        <GuideSection id="results" title="7. 결과와 리포트">
          <p><Link to="/exam-reports" className="font-bold text-accent-ink underline">시험지 관리</Link>에서는 점수, 문항별 정답률·소요시간, 성취기준별 결과와 학생별 상세 응답을 확인하고 Excel로 내보낼 수 있습니다.</p>
          <p><Link to="/standards-report" className="font-bold text-accent-ink underline">학생별 리포트</Link>에서는 한 학생이 응시한 시험 결과를 모아 볼 수 있습니다. 자동 채점과 분석 결과는 교사가 확인한 뒤 활용하세요.</p>
        </GuideSection>

        <GuideSection id="storage" title="8. 데이터 저장·백업·학기 말 삭제">
          <p>설치형 앱의 환경설정에서 현재 데이터 저장 경로를 확인하고 변경할 수 있습니다. 위치 변경 시 기존 데이터를 새 폴더로 복사한 뒤 앱이 재시작되며, 이전 폴더는 정상 동작 확인 후 직접 삭제합니다.</p>
          <p>변경 전 저장 위치는 확인 완료 전까지 교사 화면에 경고됩니다. 새 위치를 확인한 뒤 이전 폴더를 삭제하거나 학교가 허용한 방식으로 보관하고 확인을 완료하세요.</p>
          <p>백업은 전체·시험지·학생 명단·성적으로 나눠 내보내고 가져올 수 있습니다. 백업과 `.bak` 복원 사본에는 학생 정보가 포함될 수 있으므로 학교가 허용한 저장장치에서 관리하세요.</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>학기 말에 필요한 결과를 학교가 허용한 위치에 내보냅니다.</li>
            <li>학생 관리에서 전체 또는 원하는 학생의 학습 데이터를 선택 삭제하거나, 환경설정에서 학년도별 성적 데이터를 일괄 삭제합니다.</li>
            <li>더 이상 필요 없는 명단·시험·로그·이미지·복원 사본과 별도 백업을 점검·삭제합니다.</li>
            <li>공용 학생 기기의 브라우저 사이트 데이터를 삭제합니다.</li>
          </ol>
        </GuideSection>

        <GuideSection id="trouble" title="9. 문제 해결과 문의">
          <ul className="list-disc space-y-1 pl-5">
            <li><b className="text-ink">서버 오류</b>: 중복 실행 여부와 포트 4000 사용 프로그램을 확인하고 다시 실행합니다.</li>
            <li><b className="text-ink">Gemini 오류</b>: API 키, 모델 목록, Google AI Studio의 결제·사용량 한도를 확인합니다.</li>
            <li><b className="text-ink">데이터가 보이지 않음</b>: 환경설정의 현재 저장 경로를 확인하고 이전 폴더를 삭제하지 마세요.</li>
          </ul>
          <div className="rounded-xl border border-blue-100 bg-accent-soft px-4 py-3">
            <p><b className="text-ink">제품 문의</b>: <a href="mailto:isaacksh0101@sen.go.kr" className="font-bold text-accent-ink underline">isaacksh0101@sen.go.kr</a></p>
            <p><b className="text-ink">학생 데이터 요청</b>: ScoreLab을 사용한 담당 교사 또는 해당 학교</p>
            <p><b className="text-ink">변경내역·장애 공지</b>: <a href="https://github.com/isaacksh0101-svg/omrmarker" target="_blank" rel="noreferrer" className="font-bold text-accent-ink underline">GitHub 저장소</a></p>
          </div>
        </GuideSection>
      </div>
    </div>
  );
}
