/**
 * Talks to the app's HTTP API as a signed-in user, the way the browser does: session and CSRF
 * cookies kept between calls, the CSRF token sent back as a header on changes.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class ApiClient {
  private readonly cookies = new Map<string, string>();

  constructor(readonly baseUrl: string) {}

  static async signIn(baseUrl: string, email: string, password: string): Promise<ApiClient> {
    const api = new ApiClient(baseUrl.replace(/\/+$/, ''));
    await api.post('/auth/login', { email, password });
    return api;
  }

  get<T = any>(path: string): Promise<T> {
    return this.call('GET', path);
  }
  post<T = any>(path: string, body?: unknown): Promise<T> {
    return this.call('POST', path, body);
  }
  put<T = any>(path: string, body?: unknown): Promise<T> {
    return this.call('PUT', path, body);
  }
  patch<T = any>(path: string, body?: unknown): Promise<T> {
    return this.call('PATCH', path, body);
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    // The CSRF cookie can change (signing in replaces it), so the header always repeats its current value
    if (method !== 'GET' && !this.cookies.get('csrf_token')) await this.call('GET', '/auth/csrf');
    const res = await fetch(`${this.baseUrl}/api${path}`, {
      method,
      headers: {
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        ...(method !== 'GET' ? { 'x-csrf-token': this.cookies.get('csrf_token') ?? '' } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const eq = pair.indexOf('=');
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok) throw new ApiError(res.status, `${method} ${path}: ${res.status} ${data?.message ?? text}`);
    return data as T;
  }
}
