import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Dashboard } from './pages/teacher/Dashboard'
import { ExamBuilder } from './pages/teacher/exam-builder/ExamBuilder'
import { ExamResults } from './pages/teacher/ExamResults'
import { ExamReportPicker } from './pages/teacher/ExamReportPicker'
import { StandardsReport } from './pages/teacher/StandardsReport'
import { RosterPage } from './pages/roster/RosterPage'
import { StudentJoin } from './pages/student/StudentJoin'
import { TakeExam } from './pages/student/TakeExam'
import { TeacherLayout } from './components/TeacherLayout'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<TeacherLayout><Dashboard /></TeacherLayout>} />
        <Route path="/exams/:id" element={<TeacherLayout><ExamBuilder /></TeacherLayout>} />
        <Route path="/exams/:id/results" element={<TeacherLayout><ExamResults /></TeacherLayout>} />
        <Route path="/roster" element={<TeacherLayout><RosterPage /></TeacherLayout>} />
        <Route path="/standards-report" element={<TeacherLayout><StandardsReport /></TeacherLayout>} />
        <Route path="/exam-reports" element={<TeacherLayout><ExamReportPicker /></TeacherLayout>} />
        <Route path="/student" element={<StudentJoin />} />
        <Route path="/student/exam/:examId" element={<TakeExam />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
