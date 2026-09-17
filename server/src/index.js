import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import QRCode from 'qrcode';
import { Server as SocketIOServer } from 'socket.io';

import { config } from './config.js';
import { getLanIp, getLanIpCandidates } from './lib/lanIp.js';
import { setIO, monitorRoom, emitExamMonitorUpdate } from './lib/realtime.js';
import './db/index.js'; // DB 연결 + 스키마 초기화 (부작용으로 초기화됨)
import * as repo from './db/repo.js';
import { examsRouter } from './routes/exams.js';
import { aiRouter } from './routes/ai.js';
import { sessionsRouter } from './routes/sessions.js';
import { standardsRouter } from './routes/standards.js';
import { rosterRouter } from './routes/roster.js';
import { backupRouter } from './routes/backup.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// AI로 문항을 불러올 때 원본 이미지에서 잘라낸 발문 이미지 - 학생/교사 화면이 이 경로로 요청한다.
app.use('/uploads', express.static(config.uploadsDir));

app.use('/api/exams', examsRouter);
app.use('/api/exams', aiRouter);
app.use('/api/exams', sessionsRouter);
app.use('/api/standards', standardsRouter);
app.use('/api/roster', rosterRouter);
app.use('/api/backup', backupRouter);

// 호스트/IPv4 형태만 허용(간단한 검증). 교사가 직접 입력한 값을 그대로 URL에 꽂으므로
// 최소한의 형식 검사만 하고 실제로 연결되는지는 교사가 학생 기기로 직접 테스트해서 확인한다.
const isValidHostOverride = (value) => typeof value === 'string' && /^[a-zA-Z0-9.-]{1,255}$/.test(value);

app.get('/api/lan-info', async (req, res) => {
  // 항상 실제 LAN IP를 기준으로 만든다. 교사가 대시보드를 localhost로 보고 있어도
  // (예: 실행하기.bat가 자동으로 여는 주소) QR/링크는 반드시 다른 기기가 접속 가능한
  // 실제 IP를 가리켜야 한다 - 요청의 host 헤더를 그대로 쓰면 localhost가 그대로 QR에
  // 박혀서 학생 휴대폰에서 스캔했을 때 "사이트에 접근할 수 없음"이 뜨는 문제가 있었다.
  //
  // 교사 PC에 네트워크 인터페이스가 여러 개(유선+무선 등)면 자동으로 고른 IP가 학생 기기와
  // 다른 네트워크일 수 있다. candidates에 전부 나열해서 교사가 직접 골라 테스트하고,
  // ?ip= 로 특정 주소를 강제 지정할 수 있게 한다(같은 네트워크의 후보가 여러 개일 때, 또는
  // 자동 탐지에 안 잡히는 주소를 알고 있을 때).
  const override = req.query.ip;
  const candidates = getLanIpCandidates();
  const ip = isValidHostOverride(override) ? override : getLanIp();
  const url = `http://${ip}:${config.port}`;
  const studentUrl = `${url}/student`;
  // client/dist가 없으면(=npm run dev로 개발 서버만 켜둔 상태) 이 포트는 API만 응답하고
  // /student 같은 화면 경로는 서빙하지 않는다. QR은 그대로 보여주되 화면에서 경고해야 한다.
  const servingClient = fs.existsSync(config.clientDistDir);
  const qr = await QRCode.toDataURL(studentUrl).catch(() => null);
  res.json({ url, studentUrl, qr, servingClient, candidates, selectedIp: ip });
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

setIO(io);

io.on('connection', (socket) => {
  // 교사가 '시험 감독' 화면을 열면 해당 시험 방에 들어와 실시간 업데이트를 받는다.
  socket.on('monitor:join', (examId) => {
    if (Number.isInteger(Number(examId))) {
      socket.join(monitorRoom(Number(examId)));
    }
  });
  socket.on('monitor:leave', (examId) => {
    if (Number.isInteger(Number(examId))) {
      socket.leave(monitorRoom(Number(examId)));
    }
  });
  socket.on('disconnect', () => {});
});

// 학생 기기가 꺼지거나 인터넷이 끊겨서 시간 초과 시 자동 제출 요청이 서버까지 오지
// 못하면, 그 세션은 제한시간이 한참 지나도 '응시중'으로 영영 남는다(교사가 직접 강제
// 종료하거나 학생이 다시 접속해야만 정리됨). 30초마다 훑어서 그런 세션을 서버가 스스로
// 시간 초과 제출 처리한다.
const SWEEP_INTERVAL_MS = 30_000;
async function sweepTimedOutSessions() {
  try {
    const rows = await repo.getTimedOutInProgressSessions();
    const affectedExamIds = new Set();
    for (const row of rows) {
      await repo.finalizeSession(row.session_id);
      affectedExamIds.add(row.exam_id);
    }
    for (const examId of affectedExamIds) {
      emitExamMonitorUpdate(examId);
    }
  } catch (err) {
    console.error('[시간 초과 세션 정리] 오류:', err);
  }
}
setInterval(sweepTimedOutSessions, SWEEP_INTERVAL_MS);
sweepTimedOutSessions();

// listen()이 실패하면(주로 이미 다른 OMR 프로그램 창이 떠 있어서 포트가 사용 중일 때)
// 기본적으로 알아보기 힘든 스택 트레이스와 함께 그냥 죽어버린다. 원인을 바로 알 수 있게
// 안내 메시지를 남기고 종료한다 - 실행하기.bat 창에 이 메시지가 그대로 남아 보인다.
httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[오류] 포트 ${config.port}번이 이미 사용 중입니다.`);
    console.error('이미 실행 중인 OMR 프로그램 창이 있는지 확인해 주세요.');
    console.error('그런 창이 없다면 컴퓨터를 재시작한 뒤 다시 실행해 주세요.\n');
    process.exit(1);
  }
  throw err;
});

httpServer.listen(config.port, '0.0.0.0', () => {
  const ip = getLanIp();
  console.log(`OMR 서버 실행 중`);
  console.log(`  로컬:    http://localhost:${config.port}`);
  console.log(`  학생 접속용(같은 Wi-Fi): http://${ip}:${config.port}`);
});
