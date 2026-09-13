import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import QRCode from 'qrcode';
import { Server as SocketIOServer } from 'socket.io';

import { config } from './config.js';
import { getLanIp } from './lib/lanIp.js';
import './db/index.js'; // DB 연결 + 스키마 초기화 (부작용으로 초기화됨)
import { examsRouter } from './routes/exams.js';
import { aiRouter } from './routes/ai.js';
import { sessionsRouter } from './routes/sessions.js';
import { standardsRouter } from './routes/standards.js';
import { rosterRouter } from './routes/roster.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api/exams', examsRouter);
app.use('/api/exams', aiRouter);
app.use('/api/exams', sessionsRouter);
app.use('/api/standards', standardsRouter);
app.use('/api/roster', rosterRouter);

app.get('/api/lan-info', async (_req, res) => {
  // 항상 실제 LAN IP를 기준으로 만든다. 교사가 대시보드를 localhost로 보고 있어도
  // (예: 실행하기.bat가 자동으로 여는 주소) QR/링크는 반드시 다른 기기가 접속 가능한
  // 실제 IP를 가리켜야 한다 - 요청의 host 헤더를 그대로 쓰면 localhost가 그대로 QR에
  // 박혀서 학생 휴대폰에서 스캔했을 때 "사이트에 접근할 수 없음"이 뜨는 문제가 있었다.
  const ip = getLanIp();
  const url = `http://${ip}:${config.port}`;
  const studentUrl = `${url}/student`;
  // client/dist가 없으면(=npm run dev로 개발 서버만 켜둔 상태) 이 포트는 API만 응답하고
  // /student 같은 화면 경로는 서빙하지 않는다. QR은 그대로 보여주되 화면에서 경고해야 한다.
  const servingClient = fs.existsSync(config.clientDistDir);
  const qr = await QRCode.toDataURL(studentUrl).catch(() => null);
  res.json({ url, studentUrl, qr, servingClient });
});

// 프로덕션 실행: 빌드된 클라이언트 정적 파일을 같은 포트에서 서빙한다.
if (fs.existsSync(config.clientDistDir)) {
  app.use(express.static(config.clientDistDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(config.clientDistDir, 'index.html'));
  });
}

// multer(업로드) 에러를 JSON으로 응답 (파일 크기 초과, 허용되지 않는 형식 등)
app.use((err, _req, res, next) => {
  if (!err) return next();
  console.error(err);
  res.status(400).json({ error: err.message || '요청 처리 중 오류가 발생했습니다.' });
});

const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: { origin: '*' },
});

io.on('connection', (socket) => {
  socket.on('disconnect', () => {
    // TODO(M4): 세션 복구/실시간 모니터링 로직
  });
});

httpServer.listen(config.port, '0.0.0.0', () => {
  const ip = getLanIp();
  console.log(`OMR 서버 실행 중`);
  console.log(`  로컬:    http://localhost:${config.port}`);
  console.log(`  학생 접속용(같은 Wi-Fi): http://${ip}:${config.port}`);
});
