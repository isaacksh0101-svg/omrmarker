import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    chunkSizeWarningLimit: 1000, // 경고 기준을 1000kB(1MB)로 변경
  },
  server: {
    proxy: {
      '/api': 'http://localhost:4000',
      // AI로 불러온 문항의 잘라낸 이미지 - 개발 서버(vite)에도 이 경로를 알려주지 않으면
      // SPA 폴백(index.html)이 대신 응답해서 학생/편집기 화면에 깨진 이미지로 보인다.
      '/uploads': 'http://localhost:4000',
      '/socket.io': {
        target: 'http://localhost:4000',
        ws: true,
      },
    },
  },
})
