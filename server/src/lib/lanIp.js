import os from 'node:os';

// 교사 PC에 연결된 모든 네트워크 인터페이스의 IPv4 주소를 후보로 나열한다.
// 유선+무선을 동시에 쓰거나 VPN/가상 어댑터가 함께 잡히는 PC에서는 후보가 여러 개일 수 있고,
// 그중 학생 기기와 실제로 같은 네트워크에 있는 것만 접속이 된다 - 교사가 눈으로 골라 테스트할 수
// 있도록 자동 추정값 하나만 감추지 않고 전부 보여준다.
const isPrivate192or10 = (ip) => ip.startsWith('192.168.') || ip.startsWith('10.');

export function getLanIpCandidates() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      candidates.push({ name, address: iface.address });
    }
  }

  // 흔한 사설 대역(192.168.x / 10.x)을 우선 순위로 앞에 둔다 (Hyper-V, VPN 등 가상 어댑터 배제 목적).
  candidates.sort((a, b) => Number(isPrivate192or10(b.address)) - Number(isPrivate192or10(a.address)));
  return candidates;
}

// 교사 PC의 대표 LAN IP를 하나 고른다 (학생 크롬북이 접속할 주소). 자동 추정값이며,
// 실제로 맞는지는 /api/lan-info의 candidates 목록으로 교사가 확인/선택할 수 있다.
export function getLanIp() {
  const candidates = getLanIpCandidates();
  return (candidates[0] || { address: 'localhost' }).address;
}
