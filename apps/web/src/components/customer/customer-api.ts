import {
  apiErrorSchema,
  type CheckoutRequest,
  type CoinSessionView,
  coinSessionViewSchema,
  type JobView,
  jobViewSchema,
  type PrintOptions,
  type SessionResponse,
  sessionResponseSchema,
} from '@printbox/shared';
import type { z } from 'zod';
import { API_URL } from '@/lib/env';

/** `code` is an ApiErrorCode, `NETWORK` (no answer) or `generic`. */
export class ApiRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = 'ApiRequestError';
  }
}

async function errorFrom(res: Response): Promise<ApiRequestError> {
  const body: unknown = await res.json().catch(() => null);
  const parsed = apiErrorSchema.safeParse(body);
  return new ApiRequestError(parsed.success ? parsed.data.code : 'generic', res.status);
}

type SendInit = RequestInit & { token?: string };

async function send(path: string, init: SendInit): Promise<Response> {
  const { token, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (typeof rest.body === 'string') headers.set('Content-Type', 'application/json');
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...rest, headers, cache: 'no-store' });
  } catch {
    throw new ApiRequestError('NETWORK', 0);
  }
  if (!res.ok) throw await errorFrom(res);
  return res;
}

async function json<T extends z.ZodType>(
  schema: T,
  path: string,
  init: SendInit,
): Promise<z.output<T>> {
  const res = await send(path, init);
  return schema.parse(await res.json());
}

const jobPath = (jobId: string, suffix = '') => `/api/jobs/${encodeURIComponent(jobId)}${suffix}`;

export const customerApi = {
  createSession(kioskId: string, token: string): Promise<SessionResponse> {
    return json(sessionResponseSchema, '/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ kioskId, token }),
    });
  },

  getJob(token: string, jobId: string): Promise<JobView> {
    return json(jobViewSchema, jobPath(jobId), { token });
  },

  updateOptions(token: string, jobId: string, options: PrintOptions): Promise<JobView> {
    return json(jobViewSchema, jobPath(jobId, '/options'), {
      method: 'PATCH',
      token,
      body: JSON.stringify(options),
    });
  },

  checkout(token: string, jobId: string, method: CheckoutRequest['method']): Promise<JobView> {
    return json(jobViewSchema, jobPath(jobId, '/checkout'), {
      method: 'POST',
      token,
      body: JSON.stringify({ method }),
    });
  },

  startCoins(token: string, jobId: string): Promise<CoinSessionView> {
    return json(coinSessionViewSchema, jobPath(jobId, '/coin-payment'), { method: 'POST', token });
  },

  /** The reservation held by this job (404 NOT_FOUND once it ended). */
  getCoins(token: string, jobId: string): Promise<CoinSessionView> {
    return json(coinSessionViewSchema, jobPath(jobId, '/coin-payment'), { token });
  },

  async cancelCoins(token: string, jobId: string): Promise<void> {
    await send(jobPath(jobId, '/coin-payment'), { method: 'DELETE', token });
  },

  cancelJob(token: string, jobId: string): Promise<JobView> {
    return json(jobViewSchema, jobPath(jobId), { method: 'DELETE', token });
  },

  /** The thumbnail needs the bearer token, so it is fetched and shown as a blob URL. */
  async thumbnailUrl(token: string, jobId: string): Promise<string> {
    const res = await send(jobPath(jobId, '/thumbnail'), { token });
    return URL.createObjectURL(await res.blob());
  },

  /** Multipart upload with progress (fetch cannot report upload progress). */
  uploadFile(token: string, file: File, onProgress: (percent: number) => void): Promise<JobView> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_URL}/api/jobs`);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onerror = () => reject(new ApiRequestError('NETWORK', 0));
      xhr.onload = () => {
        let body: unknown = null;
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          body = null;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          const job = jobViewSchema.safeParse(body);
          if (job.success) resolve(job.data);
          else reject(new ApiRequestError('generic', xhr.status));
          return;
        }
        const error = apiErrorSchema.safeParse(body);
        reject(new ApiRequestError(error.success ? error.data.code : 'generic', xhr.status));
      };
      const form = new FormData();
      form.append('file', file, file.name);
      xhr.send(form);
    });
  },
};
