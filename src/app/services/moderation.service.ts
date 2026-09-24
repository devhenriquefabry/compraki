import { Injectable } from '@angular/core';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  Firestore, collection, deleteField, doc, getDoc, getFirestore, limit, onSnapshot, orderBy, query,
  serverTimestamp, setDoc, updateDoc, writeBatch,
} from 'firebase/firestore';
import { Observable } from 'rxjs';

import { environment } from '../../environments/environment';
import { ContentReport, ReportReason, ReportResolution, ReportTargetType } from '../interfaces/content-report';

export interface NewReport {
  targetType: ReportTargetType;
  targetId: string;
  sellerId: string;
  targetName: string;
  targetPhoto?: string | null;
  reason: ReportReason;
  details: string;
}

/**
 * Denúncias (`contentReports`), anúncio fora do ar e suspensão de conta.
 *
 * Quem denuncia escreve direto no Firestore; o resto é ação de admin. Tirar
 * anúncio do ar é um campo no produto (`moderation`) que só admin escreve.
 * Suspender conta mexe no Firebase Auth, então passa pela Cloud Function
 * `setAccountSuspension`.
 */
@Injectable({ providedIn: 'root' })
export class ModerationService {
  private readonly db: Firestore;
  private readonly functionsBaseUrl = environment.functionsBaseUrl;

  constructor() {
    const app = getApps().length === 0 ? initializeApp(environment.firebase) : getApp();
    this.db = getFirestore(app);
  }

  // ------------------------------------------------------------- denunciar

  static reportId(targetType: ReportTargetType, targetId: string, reporterId: string): string {
    return `${targetType}_${targetId}_${reporterId}`;
  }

  /** `true` quando a pessoa logada já denunciou esse alvo. */
  async alreadyReported(targetType: ReportTargetType, targetId: string): Promise<boolean> {
    const uid = getAuth().currentUser?.uid;
    if (!uid) return false;
    try {
      const snap = await getDoc(doc(this.db, 'contentReports', ModerationService.reportId(targetType, targetId, uid)));
      return snap.exists();
    } catch {
      return false;
    }
  }

  async submitReport(report: NewReport): Promise<void> {
    const user = getAuth().currentUser;
    if (!user) throw new Error('Entre na sua conta para denunciar.');

    const payload: ContentReport = {
      ...report,
      targetPhoto: report.targetPhoto || null,
      targetName: report.targetName.slice(0, 200),
      details: report.details.trim().slice(0, 1000),
      reporterId: user.uid,
      reporterName: (user.displayName || user.email || 'Usuário').slice(0, 80),
      status: 'open',
      createdAt: serverTimestamp(),
    };

    await setDoc(doc(this.db, 'contentReports', ModerationService.reportId(report.targetType, report.targetId, user.uid)), payload);
  }

  // ------------------------------------------------------------------ admin

  /** Denúncias mais recentes, em tempo real. */
  watchReports(max = 500): Observable<ContentReport[]> {
    return new Observable<ContentReport[]>(subscriber => onSnapshot(
      query(collection(this.db, 'contentReports'), orderBy('createdAt', 'desc'), limit(max)),
      snap => subscriber.next(snap.docs.map(d => ({ ...(d.data() as ContentReport), id: d.id }))),
      err => subscriber.error(err)
    ));
  }

  /** Fecha várias denúncias de uma vez (todas as do mesmo alvo, em geral). */
  async resolveReports(ids: string[], resolution: ReportResolution, note = ''): Promise<void> {
    const uid = getAuth().currentUser?.uid ?? null;
    const batch = writeBatch(this.db);
    for (const id of ids) {
      batch.update(doc(this.db, 'contentReports', id), {
        status: 'resolved',
        resolution,
        resolutionNote: note.trim().slice(0, 500),
        resolvedAt: serverTimestamp(),
        resolvedBy: uid,
      });
    }
    await batch.commit();
  }

  async reopenReports(ids: string[]): Promise<void> {
    const batch = writeBatch(this.db);
    for (const id of ids) {
      batch.update(doc(this.db, 'contentReports', id), {
        status: 'open',
        resolution: deleteField(),
        resolutionNote: deleteField(),
        resolvedAt: deleteField(),
        resolvedBy: deleteField(),
      });
    }
    await batch.commit();
  }

  async takeDownProduct(productId: string, note = ''): Promise<void> {
    await updateDoc(doc(this.db, 'products', productId), {
      moderation: {
        hidden: true,
        reason: 'removed_by_admin',
        note: note.trim().slice(0, 500),
        at: serverTimestamp(),
        by: getAuth().currentUser?.uid ?? null,
      },
    });
  }

  async restoreProduct(productId: string): Promise<void> {
    await updateDoc(doc(this.db, 'products', productId), { moderation: deleteField() });
  }

  /**
   * Derruba (ou reativa) a conta: bloqueia o login no Firebase Auth, encerra
   * as sessões abertas e tira do ar todos os anúncios da pessoa.
   */
  async setAccountSuspension(uid: string, suspended: boolean, reason = ''): Promise<void> {
    const user = getAuth().currentUser;
    if (!user) throw new Error('Sessão expirada. Faça login novamente.');
    const token = await user.getIdToken();

    const response = await fetch(`${this.functionsBaseUrl}/setAccountSuspension`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ uid, suspended, reason }),
    });

    const text = await response.text();
    let data: any = {};
    try { data = text ? JSON.parse(text) : {}; } catch { /* resposta sem JSON */ }
    if (!response.ok) throw new Error(data?.error || 'Não foi possível atualizar a conta.');
  }
}
