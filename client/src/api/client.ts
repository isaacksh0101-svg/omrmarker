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

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'POST', body: data ? JSON.stringify(data) : undefined }),
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PUT', body: data ? JSON.stringify(data) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  // FormData는 브라우저가 boundary를 포함한 Content-Type을 알아서 설정해야 하므로
  // 기본 request()의 'application/json' 헤더를 강제하지 않는 별도 경로를 쓴다.
  postForm: async <T>(path: string, formData: FormData) => {
    const res = await fetch(`/api${path}`, { method: 'POST', body: formData });
    const isJson = res.headers.get('content-type')?.includes('application/json');
    const body = isJson ? await res.json().catch(() => null) : null;
    if (!res.ok) throw new ApiError(res.status, body);
    return body as T;
  },
};
