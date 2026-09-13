import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;

// 개발 서버(vite)에서는 API가 다른 포트에서 뜨므로 현재 origin으로 접속하면 프록시를
// 거치게 되고, 프로덕션(같은 포트로 서빙)에서도 origin 그대로 접속하면 되므로 URL을
// 따로 지정하지 않고 브라우저의 현재 origin을 그대로 쓴다.
export function getSocket(): Socket {
  if (!socket) {
    socket = io({ autoConnect: true, reconnection: true });
  }
  return socket;
}
