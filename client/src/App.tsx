import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Dashboard } from './pages/teacher/Dashboard'
import { ExamBuilder } from './pages/teacher/exam-builder/ExamBuilder'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/exams/:id" element={<ExamBuilder />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
