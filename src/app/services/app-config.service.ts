import { Injectable, signal } from '@angular/core';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { Firestore, doc, getFirestore, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';

import { environment } from '../../environments/environment';
import { DEFAULT_STOREFRONT_CONFIG, FreeShippingRule, SocialLinks, StorefrontConfig } from '../interfaces/app-config';

/**
 * `appConfig/storefront` em tempo real.
 *
 * Um listener só para o app inteiro, aberto na primeira injeção e mantido
 * enquanto o app vive: é um documento pequeno, lido por vitrine, ficha,
 * carrinho, checkout e rodapé. Quando o admin muda algo no painel, todas as
 * telas abertas recebem a mudança sem recarregar.
 *
 * Documento ausente ou erro de leitura vira a configuração padrão (frete
 * grátis desligado, nada bloqueado) — a vitrine não pode quebrar por isso.
 */
@Injectable({ providedIn: 'root' })
export class AppConfigService {
  private readonly db: Firestore;

  readonly config = signal<StorefrontConfig>(DEFAULT_STOREFRONT_CONFIG);
  /** Vira `true` depois da primeira resposta do Firestore (ou do erro). */
  readonly loaded = signal(false);

  constructor() {
    const app = getApps().length === 0 ? initializeApp(environment.firebase) : getApp();
    this.db = getFirestore(app);

    onSnapshot(
      doc(this.db, 'appConfig', 'storefront'),
      snap => {
        this.config.set(normalizeConfig(snap.exists() ? snap.data() : null));
        this.loaded.set(true);
      },
      err => {
        console.warn('Configuração da loja indisponível; usando o padrão.', err);
        this.loaded.set(true);
      }
    );
  }

  /** Regra de frete grátis em vigor, ou `null` quando está desligada. */
  freeShippingRule(): FreeShippingRule | null {
    const rule = this.config().freeShipping;
    return rule.enabled && rule.minValue > 0 ? rule : null;
  }

  async saveFreeShipping(rule: FreeShippingRule): Promise<void> {
    await this.save({ freeShipping: { enabled: !!rule.enabled, minValue: roundMoney(rule.minValue) } });
  }

  async saveSocialLinks(links: SocialLinks): Promise<void> {
    const clean: SocialLinks = {};
    for (const [network, url] of Object.entries(links)) {
      const value = normalizeUrl(url);
      if (value) clean[network as keyof SocialLinks] = value;
    }
    // `merge` não apaga chave que sumiu de um mapa; por isso o mapa vai inteiro
    // com `mergeFields` restrito a ele.
    await this.save({ socialLinks: clean }, ['socialLinks']);
  }

  async saveBlockedWords(words: string[]): Promise<void> {
    const unique = Array.from(new Set(words.map(w => w.trim().toLowerCase()).filter(Boolean)));
    await this.save({ blockedWords: unique.sort((a, b) => a.localeCompare(b, 'pt-BR')) });
  }

  private async save(patch: Partial<StorefrontConfig>, replaceFields: string[] = []): Promise<void> {
    const payload = { ...patch, updatedAt: serverTimestamp(), updatedBy: getAuth().currentUser?.uid ?? null };
    const ref = doc(this.db, 'appConfig', 'storefront');
    if (replaceFields.length) {
      await setDoc(ref, payload, { mergeFields: [...replaceFields, 'updatedAt', 'updatedBy'] });
    } else {
      await setDoc(ref, payload, { merge: true });
    }
  }
}

function normalizeConfig(data: any): StorefrontConfig {
  const fs = data?.freeShipping ?? {};
  return {
    freeShipping: {
      enabled: fs.enabled === true,
      minValue: typeof fs.minValue === 'number' && fs.minValue > 0 ? fs.minValue : DEFAULT_STOREFRONT_CONFIG.freeShipping.minValue,
    },
    socialLinks: data?.socialLinks && typeof data.socialLinks === 'object' ? data.socialLinks : {},
    blockedWords: Array.isArray(data?.blockedWords) ? data.blockedWords.filter((w: unknown) => typeof w === 'string') : [],
    updatedAt: data?.updatedAt,
    updatedBy: data?.updatedBy,
  };
}

function roundMoney(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/** Aceita "instagram.com/vineon" e completa com https://. */
function normalizeUrl(url: string | undefined): string {
  const value = (url || '').trim();
  if (!value) return '';
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}
