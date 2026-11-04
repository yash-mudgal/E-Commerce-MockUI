/**
 * Browser API client. Requests go to same-origin /api/* (rewritten to the ASP.NET Core API by next.config.ts),
 * so the httpOnly session cookie stays first-party. Every request carries the CSRF header the API requires.
 */
export type Problem = {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  traceId?: string;
  errors?: Record<string, string[]>;
};

export class ApiError extends Error {
  readonly status: number;
  readonly problem: Problem;

  constructor(status: number, problem: Problem) {
    super(problem.detail || problem.title || `Request failed (${status})`);
    this.status = status;
    this.problem = problem;
  }

  /** "https://docs.shopmint.in/errors/tenant-suspended" → "tenant-suspended" */
  get code(): string | undefined {
    return this.problem.type?.split("/").pop();
  }

  /** Server field errors with paths converted for react-hook-form ("variants[0].mrp" → "variants.0.mrp"). */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, messages] of Object.entries(this.problem.errors ?? {})) {
      if (messages.length) out[toFormPath(key)] = messages[0];
    }
    return out;
  }
}

export function toFormPath(apiPath: string): string {
  return apiPath.replace(/\[(\d+)\]/g, ".$1");
}

type Options = { method?: string; body?: unknown; ifMatch?: string; signal?: AbortSignal; headers?: Record<string, string> };

export async function api<T>(path: string, { method = "GET", body, ifMatch, signal, headers: extra }: Options = {}): Promise<T> {
  const headers: Record<string, string> = { ...extra, Accept: "application/json", "X-ShopMint-Csrf": "1" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (ifMatch) headers["If-Match"] = `"${ifMatch}"`;

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, { title: "Can't reach ShopMint. Check your connection and try again." });
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? safeJson(text) : undefined;
  if (!res.ok) {
    const problem: Problem = (data && typeof data === "object" ? data : {}) as Problem;
    if (!problem.title) problem.title = res.status >= 500 ? "Something went wrong on our side." : `Request failed (${res.status})`;
    throw new ApiError(res.status, problem);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** A human-readable message for any thrown value. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.problem.detail || e.problem.title || e.message;
  if (e instanceof Error) return e.message;
  return "Something went wrong.";
}
