import { Injectable, inject, signal } from '@angular/core';
import { PublicSellerProfile } from '../interfaces/seller';
import { FirebaseUsersService } from './firebase-users.service';

/**
 * Nome e foto das lojas para as listas de pedidos. Lê `sellers/{uid}` (leitura
 * pública) uma vez por loja por sessão.
 */
@Injectable({ providedIn: 'root' })
export class SellerDirectoryService {
  private readonly users = inject(FirebaseUsersService);
  private readonly requested = new Set<string>();

  readonly profiles = signal<Record<string, PublicSellerProfile | null>>({});

  async ensure(ids: Iterable<string>) {
    const missing = [...new Set(ids)].filter(id => id && id !== 'unknown' && !this.requested.has(id));
    if (!missing.length) return;
    missing.forEach(id => this.requested.add(id));

    const entries = await Promise.all(
      missing.map(async id => [id, await this.users.getPublicSellerProfile(id).catch(() => null)] as const)
    );
    this.profiles.update(current => ({ ...current, ...Object.fromEntries(entries) }));
  }

  name(id: string | undefined | null): string {
    if (!id) return 'Loja';
    const p = this.profiles()[id];
    return p?.shopName || p?.displayName || 'Loja Vineon';
  }
}
