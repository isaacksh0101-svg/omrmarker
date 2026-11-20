import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, useLocation, useNavigationType } from 'react-router-dom'
import { Dashboard } from './pages/teacher/Dashboard'
import { ExamBuilder } from './pages/teacher/exam-builder/ExamBuilder'
import { ExamResults } from './pages/teacher/ExamResults'
import { SessionReview } from './pages/teacher/SessionReview'
import { ExamReportPicker } from './pages/teacher/ExamReportPicker'
import { ExamManagement } from './pages/teacher/ExamManagement'
import { ExamMonitorPicker } from './pages/teacher/ExamMonitorPicker'
import { ExamMonitor } from './pages/teacher/ExamMonitor'
import { StandardsReport } from './pages/teacher/StandardsReport'
import { DataManagementPage, SettingsPage } from './pages/teacher/SettingsPage'
import { RosterPage } from './pages/roster/RosterPage'
import { StudentJoin } from './pages/student/StudentJoin'
import { TakeExam } from './pages/student/TakeExam'
import { ReviewMistakes } from './pages/student/ReviewMistakes'
import { TeacherLayout } from './components/TeacherLayout'
import { AuthGate } from './components/AuthGate'
import { InitialSetupGate } from './components/InitialSetupGate'
import { ResultSheets } from './pages/teacher/ResultSheets'
import { LegalFooter } from './components/LegalFooter'

// 시험 응시 화면은 자체적으로 높이를 꽉 채우고 내부(연습장 영역)만 스크롤되는 레이아웃을
// 쓴다 - 그 아래에 이 푸터까지 붙으면 페이지 전체도 같이 스크롤되는 이중 스크롤 구조가
// 되어 헷갈리므로, 이 화면에서는 아예 렌더링하지 않는다.
function AppShell() {
  const location = useLocation();
  const navigationType = useNavigationType();
  // 결과지 출력 화면은 푸터가 인쇄물에 같이 찍히지 않게 뺀다.
  const hideFooter = location.pathname.startsWith('/student/exam/') || location.pathname.endsWith('/result-sheets');

  // SPA는 화면을 바꿔도 창 스크롤 위치가 그대로 남는다 - 시험별 분석 아래쪽 학생 목록에서
  // 개별 결과를 열면 새 화면도 맨 아래부터 보이는 문제가 있었다. 새로 이동할 때는 맨 위로
  // 올리고, 뒤로 가기(POP)는 이전 위치를 유지하도록 그대로 둔다.
  useEffect(() => {
    if (navigationType !== 'POP') window.scrollTo(0, 0);
  }, [location.pathname, navigationType]);

  return (
    <div className="flex min-h-screen flex-col">
      <div className="min-h-0 flex-1">
        <Routes>
          <Route path="/" element={<TeacherLayout><Dashboard /></TeacherLayout>} />
          <Route path="/exams/:id" element={<TeacherLayout><ExamBuilder /></TeacherLayout>} />
          <Route path="/exam-management" element={<TeacherLayout><ExamManagement /></TeacherLayout>} />
          <Route path="/exam-management/:id" element={<TeacherLayout><ExamBuilder /></TeacherLayout>} />
          <Route path="/exams/:id/results" element={<TeacherLayout><ExamResults /></TeacherLayout>} />
          <Route path="/exams/:id/sessions/:sessionId" element={<TeacherLayout><SessionReview /></TeacherLayout>} />
          {/* 출력용이라 왼쪽 메뉴 없이 보여준다(로그인은 똑같이 필요). */}
          <Route path="/exams/:id/result-sheets" element={<InitialSetupGate><AuthGate><ResultSheets /></AuthGate></InitialSetupGate>} />
          <Route path="/roster" element={<TeacherLayout><RosterPage /></TeacherLayout>} />
          <Route path="/exam-monitor" element={<TeacherLayout><ExamMonitorPicker /></TeacherLayout>} />
          <Route path="/exam-monitor/:id" element={<TeacherLayout><ExamMonitor /></TeacherLayout>} />
          <Route path="/standards-report" element={<TeacherLayout><StandardsReport /></TeacherLayout>} />
          <Route path="/exam-reports" element={<TeacherLayout><ExamReportPicker /></TeacherLayout>} />
          <Route path="/settings" element={<TeacherLayout><SettingsPage /></TeacherLayout>} />
          <Route path="/data-management" element={<TeacherLayout><DataManagementPage /></TeacherLayout>} />
          <Route path="/student" element={<StudentJoin />} />
          <Route path="/student/exam/:examId" element={<TakeExam />} />
          <Route path="/student/exam/:examId/review" element={<ReviewMistakes />} />
        </Routes>
      </div>
      {!hideFooter && <LegalFooter />}
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  )
}

export default App
