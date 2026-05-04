import { Injectable } from '@angular/core';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { environment } from '../../environments/environment';

export interface WhatsappInstanceRequest {
  instanceName: string;
  webhookUrl?: string;
}

export interface WhatsappTestMessageRequest {
  instanceName: string;
  phoneNumber: string;
  message: string;
}

export interface WhatsappMediaMessageRequest {
  instanceName: string;
  phoneNumber: string;
  mediaBase64: string;
  mimetype: string;
  fileName?: string;
  caption?: string;
  mediaType?: 'image' | 'video' | 'audio' | 'document';
}

export type WhatsappTriggerEvent =
  | 'account_created'
  | 'product_uploaded'
  | 'new_conversation'
  | 'product_sold'
  | 'new_login';

export interface WhatsappTriggerConfig {
  eventType: WhatsappTriggerEvent;
  label: string;
  enabled: boolean;
  instanceName: string;
  phoneNumber: string;
  message: string;
}

export interface WhatsappTriggerDispatchRequest {
  eventType: WhatsappTriggerEvent;
  data?: Record<string, unknown>;
}

export interface WhatsappInstanceResponse {
  [key: string]: unknown;
}

export interface WhatsappInstanceLockStatus {
  instanceName: string;
  locked: boolean;
}

export interface WhatsappInstanceCodeRequestResponse {
  instanceName: string;
  expiresAt: number;
  maskedNumber: string;
}

export interface EvolutionMediaResolutionResponse {
  mediaId?: string | null;
  url?: string;
  mimetype?: string;
  fromCache?: boolean;
  cacheLayer?: 'storage' | 'firestore' | 'inline' | string;
  sizeBytes?: number | null;
  /** Mantido temporariamente para compatibilidade durante o rollout do cache. */
  dataUrl?: string;
}

@Injectable({
  providedIn: 'root'
})
export class WhatsappInstancesService {
  private auth: Auth;
  private functionsBaseUrl = `https://us-central1-${environment.firebase.projectId}.cloudfunctions.net`;

  constructor() {
    const app = getApps().length === 0 ? initializeApp(environment.firebase) : getApp();
    this.auth = getAuth(app);
  }

  createInstance(payload: WhatsappInstanceRequest): Promise<WhatsappInstanceResponse> {
    return this.callFunction<WhatsappInstanceResponse>('createWhatsappInstance', {
      method: 'POST',
      body: payload
    });
  }

  getQrCode(instanceName: string): Promise<WhatsappInstanceResponse> {
    return this.callFunction<WhatsappInstanceResponse>(
      `getWhatsappQrCode?instanceName=${encodeURIComponent(instanceName)}`
    );
  }

  listInstances(): Promise<WhatsappInstanceResponse> {
    return this.callFunction<WhatsappInstanceResponse>('listWhatsappInstances');
  }

  disconnectInstance(instanceName: string): Promise<WhatsappInstanceResponse> {
    return this.callFunction<WhatsappInstanceResponse>('disconnectWhatsappInstance', {
      method: 'POST',
      body: { instanceName }
    });
  }

  deleteInstance(instanceName: string): Promise<WhatsappInstanceResponse> {
    return this.callFunction<WhatsappInstanceResponse>('deleteWhatsappInstance', {
      method: 'DELETE',
      body: { instanceName }
    });
  }

  sendTestMessage(payload: WhatsappTestMessageRequest): Promise<WhatsappInstanceResponse> {
    return this.callFunction<WhatsappInstanceResponse>('sendWhatsappTestMessage', {
      method: 'POST',
      body: payload
    });
  }

  sendMediaMessage(payload: WhatsappMediaMessageRequest): Promise<WhatsappInstanceResponse> {
    return this.callFunction<WhatsappInstanceResponse>('sendWhatsappMediaMessage', {
      method: 'POST',
      body: payload
    });
  }

  /** Lista conversas (chats) na instância Evolution (admin). */
  listEvolutionChats(instanceName: string): Promise<WhatsappInstanceResponse> {
    return this.callFunction<WhatsappInstanceResponse>('listWhatsappEvolutionChats', {
      method: 'POST',
      body: { instanceName }
    });
  }

  /** Carrega histórico de mensagens de um JID (contato ou grupo) na instância. */
  listEvolutionMessages(
    instanceName: string,
    remoteJid: string,
    limit = 80,
    page = 1
  ): Promise<WhatsappInstanceResponse> {
    return this.callFunction<WhatsappInstanceResponse>('listWhatsappEvolutionMessages', {
      method: 'POST',
      body: { instanceName, remoteJid, limit, page }
    });
  }

  resolveEvolutionMedia(
    instanceName: string,
    message: unknown
  ): Promise<EvolutionMediaResolutionResponse> {
    return this.callFunction<EvolutionMediaResolutionResponse>('resolveWhatsappEvolutionMedia', {
      method: 'POST',
      body: { instanceName, message }
    });
  }

  getInstanceLockStatus(instanceName: string): Promise<WhatsappInstanceLockStatus> {
    return this.callFunction<WhatsappInstanceLockStatus>(`getWhatsappInstanceLockStatus?instanceName=${encodeURIComponent(instanceName)}`);
  }

  requestInstanceAccessCode(
    instanceName: string,
    intent: 'lock' | 'unlock'
  ): Promise<WhatsappInstanceCodeRequestResponse> {
    return this.callFunction<WhatsappInstanceCodeRequestResponse>('requestWhatsappInstanceAccessCode', {
      method: 'POST',
      body: { instanceName, intent }
    });
  }

  confirmInstanceAccessCode(
    instanceName: string,
    code: string,
    intent: 'lock' | 'unlock'
  ): Promise<WhatsappInstanceLockStatus> {
    return this.callFunction<WhatsappInstanceLockStatus>('confirmWhatsappInstanceAccessCode', {
      method: 'POST',
      body: { instanceName, code, intent }
    });
  }

  async getTriggers(): Promise<WhatsappTriggerConfig[]> {
    const response = await this.callFunction<{ triggers?: WhatsappTriggerConfig[] }>('getWhatsappTriggers');
    return response.triggers || [];
  }

  saveTrigger(payload: WhatsappTriggerConfig): Promise<{ trigger: WhatsappTriggerConfig }> {
    return this.callFunction<{ trigger: WhatsappTriggerConfig }>('saveWhatsappTrigger', {
      method: 'POST',
      body: payload
    });
  }

  dispatchTrigger(payload: WhatsappTriggerDispatchRequest): Promise<WhatsappInstanceResponse> {
    return this.callFunction<WhatsappInstanceResponse>('dispatchWhatsappTrigger', {
      method: 'POST',
      body: payload
    });
  }

  private async callFunction<T>(
    functionNameAndQuery: string,
    options: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown } = {}
  ): Promise<T> {
    const token = await this.auth.currentUser?.getIdToken();
    if (!token) {
      throw new Error('Usuário precisa estar autenticado para gerenciar WhatsApp.');
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
        : 'Erro ao chamar serviço de WhatsApp.';
      throw new Error(errorMessage);
    }

    return data as T;
  }
}
