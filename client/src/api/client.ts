export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    const message = (body as { error?: string })?.error || `요청 실패 (${status})`;
    super(message);
    this.status = status;
    this.body = body;
  }
}

// 로그인 세션이 없거나 만료돼 401을 받으면, 화면을 감싸고 있는 AuthGate가 로그인 화면으로
// 돌아가도록 알려준다. 학생 화면(로그인 자체가 없음)의 요청은 애초에 401을 받을 일이 없다.
function notifyUnauthorized() {
  window.dispatchEvent(new Event('scorelab:unauthorized'));
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json().catch(() => null) : null;
  if (res.status === 401) notifyUnauthorized();
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'POST', body: data ? JSON.stringify(data) : undefined }),
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PUT', body: data ? JSON.stringify(data) : undefined }),
  delete: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'DELETE', body: data ? JSON.stringify(data) : undefined }),
  // FormData는 브라우저가 boundary를 포함한 Content-Type을 알아서 설정해야 하므로
  // 기본 request()의 'application/json' 헤더를 강제하지 않는 별도 경로를 쓴다.
  postForm: async <T>(path: string, formData: FormData) => {
    const res = await fetch(`/api${path}`, { method: 'POST', body: formData });
    const isJson = res.headers.get('content-type')?.includes('application/json');
    const body = isJson ? await res.json().catch(() => null) : null;
    if (res.status === 401) notifyUnauthorized();
    if (!res.ok) throw new ApiError(res.status, body);
    return body as T;
  },
  // 서버가 내려주는 파일(백업 등)을 받아서 그대로 저장 대화상자를 띄운다.
  downloadFile: async (path: string, filename: string) => {
    const res = await fetch(`/api${path}`);
    if (!res.ok) {
      const isJson = res.headers.get('content-type')?.includes('application/json');
      const body = isJson ? await res.json().catch(() => null) : null;
      if (res.status === 401) notifyUnauthorized();
      throw new ApiError(res.status, body);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
};
