import { Injectable } from '@angular/core';
import {
  EvolutionMediaResolutionResponse,
  WhatsappInstancesService
} from './whatsapp-instances.service';

const DB_NAME = 'compraki-media-cache';
const DB_VERSION = 1;
const STORE_NAME = 'media-cache-v1';
const DEFAULT_CAP_BYTES = 300 * 1024 * 1024;
const EVICTION_TARGET_RATIO = 0.8;

interface MediaCacheRecord {
  mediaId: string;
  url: string;
  mimetype: string;
  sizeBytes: number;
  instanceName: string;
  createdAt: number;
  lastAccessedAt: number;
}

export interface ResolvedMedia {
  url: string;
  mimetype: string;
  fromCache: boolean;
  cacheLayer: 'local' | 'firestore' | 'storage' | 'inline';
  mediaId?: string;
}

interface MediaKeyInputs {
  instanceName: string;
  remoteJid: string;
  id: string;
  fromMe: boolean;
}

/**
 * Cache de mídias do WhatsApp em três camadas:
 *  1. IndexedDB local (este service) -- evita até a chamada da Function.
 *  2. Firestore (`whatsappMediaCache`) -- compartilhado entre admins/dispositivos.
 *  3. Firebase Storage -- guarda o binário decodificado, com cache HTTP de 1 ano.
 *
 * Faz dedupe in-flight (vários consumidores aguardam a mesma Promise por mediaId)
 * e LRU baseado em `lastAccessedAt`, com capacidade configurável.
 */
@Injectable({ providedIn: 'root' })
export class MediaCacheService {
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  private inFlight = new Map<string, Promise<ResolvedMedia | null>>();
  private failedIds = new Set<string>();
  private capBytes = DEFAULT_CAP_BYTES;

  constructor(private whatsapp: WhatsappInstancesService) {}

  /**
   * Resolve a mídia de uma mensagem WhatsApp consultando local → backend.
   * Retorna `null` quando não há mídia renderizável ou quando todas as camadas falham.
   */
  async getOrResolveMedia(
    instanceName: string,
    message: unknown
  ): Promise<ResolvedMedia | null> {
    const inputs = this.extractKeyInputs(instanceName, message);
    if (!inputs) {
      return this.resolveDirect(instanceName, message, null);
    }

    const mediaId = await this.computeMediaId(inputs);
    if (!mediaId) {
      return this.resolveDirect(instanceName, message, null);
    }

    if (this.failedIds.has(mediaId)) {
      return null;
    }

    const local = await this.readLocal(mediaId);
    if (local?.url) {
      void this.touchLocal(mediaId);
      return {
        url: local.url,
        mimetype: local.mimetype,
        fromCache: true,
        cacheLayer: 'local',
        mediaId
      };
    }

    const inFlight = this.inFlight.get(mediaId);
    if (inFlight) return inFlight;

    const pending = this.resolveDirect(instanceName, message, mediaId)
      .finally(() => this.inFlight.delete(mediaId));
    this.inFlight.set(mediaId, pending);
    return pending;
  }

  /** Marca um mediaId como falho até a próxima limpeza/recarregamento. */
  markFailed(mediaId: string): void {
    this.failedIds.add(mediaId);
  }

  /** Limpa o set de falhas - útil ao trocar de instância/conversa. */
  clearFailedIds(): void {
    this.failedIds.clear();
  }

  /** Permite ajustar o tamanho máximo do cache local (em bytes). */
  setCapBytes(value: number): void {
    if (Number.isFinite(value) && value > 0) {
      this.capBytes = value;
    }
  }

  /** Estatísticas básicas para debug/observabilidade. */
  async getStats(): Promise<{ entries: number; bytes: number }> {
    const records = await this.listAll();
    return {
      entries: records.length,
      bytes: records.reduce((sum, r) => sum + (r.sizeBytes || 0), 0)
    };
  }

  private async resolveDirect(
    instanceName: string,
    message: unknown,
    mediaId: string | null
  ): Promise<ResolvedMedia | null> {
    let response: EvolutionMediaResolutionResponse;
    try {
      response = await this.whatsapp.resolveEvolutionMedia(instanceName, message);
    } catch {
      if (mediaId) this.failedIds.add(mediaId);
      return null;
    }

    const url = response.url || response.dataUrl;
    if (!url) {
      if (mediaId) this.failedIds.add(mediaId);
      return null;
    }

    const finalMediaId = response.mediaId || mediaId || undefined;
    const mimetype = response.mimetype || 'application/octet-stream';
    const cacheLayer: ResolvedMedia['cacheLayer'] =
      response.fromCache && response.cacheLayer === 'firestore'
        ? 'firestore'
        : response.cacheLayer === 'storage'
        ? 'storage'
        : 'inline';

    if (finalMediaId && response.url) {
      // só persistimos URLs estáveis (storage ou firestore); data: URLs ficam só em memória.
      await this.writeLocal({
        mediaId: finalMediaId,
        url: response.url,
        mimetype,
        sizeBytes: typeof response.sizeBytes === 'number' ? response.sizeBytes : 0,
        instanceName
      });
      void this.enforceCap();
    }

    return {
      url,
      mimetype,
      fromCache: Boolean(response.fromCache),
      cacheLayer,
      mediaId: finalMediaId
    };
  }

  private extractKeyInputs(instanceName: string, message: unknown): MediaKeyInputs | null {
    if (!message || typeof message !== 'object') return null;
    const rec = message as Record<string, unknown>;
    const key = (rec['key'] && typeof rec['key'] === 'object'
      ? (rec['key'] as Record<string, unknown>)
      : null) as Record<string, unknown> | null;

    const id = String(key?.['id'] ?? rec['id'] ?? '').trim();
    if (!id) return null;
    const remoteJid = String(key?.['remoteJid'] ?? rec['remoteJid'] ?? '').trim();
    const fromMe = key?.['fromMe'] === true || rec['fromMe'] === true;

    return {
      instanceName: instanceName.trim().toLowerCase(),
      remoteJid,
      id,
      fromMe
    };
  }

  private async computeMediaId(inputs: MediaKeyInputs): Promise<string | null> {
    if (typeof crypto === 'undefined' || !crypto.subtle) return null;
    const seed = `${inputs.instanceName}|${inputs.remoteJid}|${inputs.id}|${inputs.fromMe ? '1' : '0'}`;
    const buf = new TextEncoder().encode(seed);
    const digest = await crypto.subtle.digest('SHA-1', buf);
    const bytes = new Uint8Array(digest);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
  }

  private getDb(): Promise<IDBDatabase | null> {
    if (this.dbPromise) return this.dbPromise;
    if (typeof indexedDB === 'undefined') {
      this.dbPromise = Promise.resolve(null);
      return this.dbPromise;
    }
    this.dbPromise = new Promise<IDBDatabase | null>((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: 'mediaId' });
            store.createIndex('lastAccessedAt', 'lastAccessedAt', { unique: false });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return this.dbPromise;
  }

  private async readLocal(mediaId: string): Promise<MediaCacheRecord | null> {
    const db = await this.getDb();
    if (!db) return null;
    return new Promise<MediaCacheRecord | null>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(mediaId);
        req.onsuccess = () => resolve((req.result as MediaCacheRecord) || null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  private async writeLocal(record: Omit<MediaCacheRecord, 'createdAt' | 'lastAccessedAt'>): Promise<void> {
    const db = await this.getDb();
    if (!db) return;
    const now = Date.now();
    const full: MediaCacheRecord = {
      ...record,
      createdAt: now,
      lastAccessedAt: now
    };
    return new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put(full);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  private async touchLocal(mediaId: string): Promise<void> {
    const db = await this.getDb();
    if (!db) return;
    return new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(mediaId);
        req.onsuccess = () => {
          const rec = req.result as MediaCacheRecord | undefined;
          if (rec) {
            rec.lastAccessedAt = Date.now();
            store.put(rec);
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  private async listAll(): Promise<MediaCacheRecord[]> {
    const db = await this.getDb();
    if (!db) return [];
    return new Promise<MediaCacheRecord[]>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => resolve((req.result as MediaCacheRecord[]) || []);
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  }

  private async enforceCap(): Promise<void> {
    const records = await this.listAll();
    const total = records.reduce((sum, r) => sum + (r.sizeBytes || 0), 0);
    if (total <= this.capBytes) return;

    const target = Math.floor(this.capBytes * EVICTION_TARGET_RATIO);
    const sorted = [...records].sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
    const idsToRemove: string[] = [];
    let remaining = total;
    for (const rec of sorted) {
      if (remaining <= target) break;
      idsToRemove.push(rec.mediaId);
      remaining -= rec.sizeBytes || 0;
    }
    if (!idsToRemove.length) return;

    const db = await this.getDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        for (const id of idsToRemove) {
          store.delete(id);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  }
}
