import { getLanIpCandidates } from '../lib/lanIp.js';

function normalizeHostname(value) {
  return String(value || '').replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
}

function parseAuthority(authority) {
  try {
    const parsed = new URL(`http://${authority}`);
    return { hostname: normalizeHostname(parsed.hostname), port: parsed.port || '80' };
  } catch {
    return null;
  }
}

function allowedHostname(hostname) {
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true;
  return getLanIpCandidates().some((candidate) => normalizeHostname(candidate.address) === hostname);
}

export function trustedBrowserRequest(req) {
  const host = parseAuthority(req.headers.host);
  if (!host || !allowedHostname(host.hostname)) return false;

  const originHeader = req.headers.origin;
  if (!originHeader) return true;
  try {
    const origin = new URL(originHeader);
    const originHost = {
      hostname: normalizeHostname(origin.hostname),
      port: origin.port || (origin.protocol === 'https:' ? '443' : '80'),
    };
    return origin.protocol === 'http:'
      && originHost.hostname === host.hostname
      && originHost.port === host.port;
  } catch {
    return false;
  }
}

export function requireTrustedBrowserRequest(req, res, next) {
  if (trustedBrowserRequest(req)) return next();
  return res.status(403).json({ error: '허용되지 않은 웹 페이지 또는 주소에서 보낸 요청입니다.' });
}
