import os from 'node:os';

// 교사 PC의 LAN IP를 찾는다 (학생 크롬북이 접속할 주소).
// 가상 어댑터(Hyper-V, VPN 등)를 배제하기 위해 흔한 사설 대역을 우선한다.
export function getLanIp() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      candidates.push({ name, address: iface.address });
    }
  }

  const isPrivate192or10 = (ip) => ip.startsWith('192.168.') || ip.startsWith('10.');
  const preferred = candidates.find((c) => isPrivate192or10(c.address));
  return (preferred || candidates[0] || { address: 'localhost' }).address;
}
