'use client';

import {
  ClientEvent,
  ConversionStatus,
  type JobView,
  jobViewSchema,
  SocketNamespace,
} from '@printbox/shared';
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { API_URL } from '@/lib/env';
import { customerApi } from './customer-api';

/** While the file is converted (no status change, so nothing is pushed). */
const CONVERSION_POLL_MS = 1500;
/** Fallback while the socket is down (weak 4G). */
const OFFLINE_POLL_MS = 5000;

const FINAL_STATUSES = new Set<JobView['status']>(['PRINTED', 'CANCELLED', 'EXPIRED']);

export function isConverting(job: JobView): boolean {
  return (
    job.conversionStatus === ConversionStatus.PENDING ||
    job.conversionStatus === ConversionStatus.PROCESSING
  );
}

export interface LiveJob {
  job: JobView;
  /** Replaces the job with a fresher view (answer of a REST call). */
  setJob: (job: JobView) => void;
  connected: boolean;
}

/**
 * Follows one job: pushes on the `/clients` namespace (room per job, re-subscribed after each
 * reconnection), plus polling while the file is converted or the socket is down.
 * The caller remounts it (React `key`) when the followed job changes.
 */
export function useLiveJob(sessionToken: string, initial: JobView): LiveJob {
  const jobId = initial.id;
  const [job, setJob] = useState<JobView>(initial);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = io(`${API_URL}${SocketNamespace.CLIENTS}`, {
      auth: { sessionToken },
      transports: ['websocket'],
      reconnectionDelayMax: 10_000,
    });
    socket.on('connect', () => {
      setConnected(true);
      socket.emit(ClientEvent.SUBSCRIBE, { jobId });
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));
    socket.on(ClientEvent.JOB_STATUS, (raw: unknown) => {
      const parsed = jobViewSchema.safeParse(raw);
      if (parsed.success && parsed.data.id === jobId) setJob(parsed.data);
    });
    return () => {
      socket.disconnect();
    };
  }, [sessionToken, jobId]);

  let pollMs: number | null = null;
  if (!FINAL_STATUSES.has(job.status)) {
    if (isConverting(job)) pollMs = CONVERSION_POLL_MS;
    else if (!connected) pollMs = OFFLINE_POLL_MS;
  }

  useEffect(() => {
    if (pollMs === null) return;
    let cancelled = false;
    const timer = setInterval(() => {
      customerApi
        .getJob(sessionToken, jobId)
        .then((fresh) => {
          if (!cancelled) setJob(fresh);
        })
        .catch(() => {
          // Network hiccup: the next tick tries again.
        });
    }, pollMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sessionToken, jobId, pollMs]);

  return { job, setJob, connected };
}
