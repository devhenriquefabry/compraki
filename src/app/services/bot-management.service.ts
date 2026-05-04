import { Injectable } from '@angular/core';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { environment } from '../../environments/environment';

export type BotJobStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled';

export interface BotCatalogItem {
  name: string;
  type: string;
  icon: string;
  description: string;
  script: string;
  defaults: {
    keyword?: string;
    count?: number | null;
    headless?: boolean;
    mode?: 'batch' | 'alternate';
  };
}

export interface BotJobPayload {
  keyword?: string;
  count?: number | null;
  headless?: boolean;
  mode?: 'batch' | 'alternate';
  [key: string]: unknown;
}

export interface BotJob {
  id: string;
  botType: string;
  botLabel: string;
  script: string;
  status: BotJobStatus;
  priority: number;
  payload: BotJobPayload;
  createdAtIso?: string;
  updatedAtIso?: string;
  createdByEmail?: string | null;
  errorMessage?: string | null;
}

export interface BotLogLine {
  level: 'info' | 'warn' | 'error';
  message: string;
  atIso: string;
}

export interface BotOpsSummary {
  queued: number;
  running: number;
  success: number;
  failed: number;
  cancelled: number;
  total: number;
}

@Injectable({
  providedIn: 'root'
})
export class BotManagementService {
  private auth: Auth;
  private functionsBaseUrl = `https://us-central1-${environment.firebase.projectId}.cloudfunctions.net`;

  constructor() {
    const app = getApps().length === 0 ? initializeApp(environment.firebase) : getApp();
    this.auth = getAuth(app);
  }

  createJob(item: BotCatalogItem, payload: BotJobPayload, priority = 0): Promise<{ jobId: string; status: string }> {
    return this.callFunction<{ jobId: string; status: string }>('createBotJob', {
      method: 'POST',
      body: {
        botType: item.type,
        botLabel: item.name,
        script: item.script,
        priority,
        payload
      }
    });
  }

  listJobs(status = '', limit = 80): Promise<BotJob[]> {
    const query = new URLSearchParams();
    if (status) query.set('status', status);
    query.set('limit', String(limit));
    const qs = query.toString();
    return this.callFunction<{ jobs?: BotJob[] }>(`listBotJobs${qs ? `?${qs}` : ''}`)
      .then(result => result.jobs || []);
  }

  cancelJob(jobId: string): Promise<{ ok: boolean }> {
    return this.callFunction<{ ok: boolean }>('cancelBotJob', {
      method: 'POST',
      body: { jobId }
    });
  }

  retryJob(jobId: string): Promise<{ ok: boolean }> {
    return this.callFunction<{ ok: boolean }>('retryBotJob', {
      method: 'POST',
      body: { jobId }
    });
  }

  listJobLogs(jobId: string): Promise<BotLogLine[]> {
    return this.callFunction<{ logs?: BotLogLine[] }>(`listBotJobLogs?jobId=${encodeURIComponent(jobId)}`)
      .then(result => result.logs || []);
  }

  getSummary(): Promise<BotOpsSummary> {
    return this.callFunction<{ summary?: BotOpsSummary }>('getBotOpsSummary')
      .then(result => result.summary || {
        queued: 0,
        running: 0,
        success: 0,
        failed: 0,
        cancelled: 0,
        total: 0
      });
  }

  private async callFunction<T>(
    functionNameAndQuery: string,
    options: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown } = {}
  ): Promise<T> {
    const token = await this.auth.currentUser?.getIdToken();
    if (!token) {
      throw new Error('Usuário precisa estar autenticado para gerenciar bots.');
    }

    const response = await fetch(`${this.functionsBaseUrl}/${functionNameAndQuery}`, {
      method: options.method || 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errorMessage = typeof data?.error === 'string'
        ? data.error
        : 'Erro ao chamar serviço de bots.';
      throw new Error(errorMessage);
    }

    return data as T;
  }
}
