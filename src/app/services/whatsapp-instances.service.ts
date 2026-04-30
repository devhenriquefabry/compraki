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
