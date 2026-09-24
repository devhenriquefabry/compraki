import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AlertController, IonicModule, ToastController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { flagOutline, personOutline, pricetagOutline, shieldCheckmarkOutline } from 'ionicons/icons';

import { formatDay, toDate } from '../../core/order-stage';
import {
  ContentReport, REPORT_RESOLUTION_LABEL, ReportResolution, ReportTargetType, reportReasonLabel,
} from '../../interfaces/content-report';
import { ModerationService } from '../../services/moderation.service';

type StatusFilter = 'open' | 'resolved';
type TypeFilter = 'all' | ReportTargetType;

/** Denúncias do mesmo alvo viram um card só: o admin decide uma vez. */
interface ReportGroup {
  key: string;
  targetType: ReportTargetType;
  targetId: string;
  sellerId: string;
  targetName: string;
  targetPhoto: string | null;
  reports: ContentReport[];
  reasons: { label: string; count: number }[];
  latest: string;
  resolution?: ReportResolution;
  resolutionLabel?: string;
  resolutionNote?: string;
}

/**
 * Aba "Denúncias" do painel: anúncios e vendedores denunciados por quem usa
 * o app. Daqui o admin tira o anúncio do ar, suspende a conta ("derruba") ou
 * descarta a denúncia. Tudo em tempo real.
 */
@Component({
  selector: 'app-manage-reports',
  templateUrl: './manage-reports.page.html',
  styleUrls: ['./manage-reports.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule],
})
export class ManageReportsPage {
  private readonly moderation = inject(ModerationService);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);

  readonly loading = signal(true);
  readonly error = signal('');
  readonly reports = signal<ContentReport[]>([]);
  readonly status = signal<StatusFilter>('open');
  readonly type = signal<TypeFilter>('all');
  readonly busyKey = signal<string | null>(null);

  readonly groups = computed<ReportGroup[]>(() => {
    const map = new Map<string, ContentReport[]>();
    for (const report of this.reports()) {
      if (report.status !== this.status()) continue;
      if (this.type() !== 'all' && report.targetType !== this.type()) continue;
      const key = `${report.targetType}_${report.targetId}`;
      const list = map.get(key) ?? [];
      list.push(report);
      map.set(key, list);
    }

    return Array.from(map.entries())
      .map(([key, reports]) => {
        const first = reports[0];
        const reasonCount = new Map<string, number>();
        for (const r of reports) {
          const label = reportReasonLabel(r.reason);
          reasonCount.set(label, (reasonCount.get(label) ?? 0) + 1);
        }
        return {
          key,
          targetType: first.targetType,
          targetId: first.targetId,
          sellerId: first.sellerId,
          targetName: first.targetName,
          targetPhoto: first.targetPhoto ?? null,
          reports,
          reasons: Array.from(reasonCount.entries()).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
          latest: stamp(first.createdAt),
          resolution: first.resolution,
          resolutionLabel: first.resolution ? REPORT_RESOLUTION_LABEL[first.resolution] : undefined,
          resolutionNote: first.resolutionNote,
        } as ReportGroup;
      })
      // Mais denunciados primeiro; empate, o mais recente.
      .sort((a, b) => b.reports.length - a.reports.length);
  });

  readonly openCount = computed(() => this.reports().filter(r => r.status === 'open').length);

  readonly reasonLabel = reportReasonLabel;
  readonly stamp = stamp;

  private stop?: () => void;

  constructor() {
    addIcons({ flagOutline, personOutline, pricetagOutline, shieldCheckmarkOutline });
    inject(DestroyRef).onDestroy(() => this.stop?.());

    const sub = this.moderation.watchReports().subscribe({
      next: reports => {
        this.reports.set(reports);
        this.loading.set(false);
      },
      error: err => {
        console.error('Falha ao carregar denúncias', err);
        this.error.set('Não foi possível carregar as denúncias. As regras novas do Firestore já foram publicadas?');
        this.loading.set(false);
      },
    });
    this.stop = () => sub.unsubscribe();
  }

  // ------------------------------------------------------------------ ações

  async dismiss(group: ReportGroup) {
    const note = await this.ask('Descartar denúncia', 'Nada a fazer com este item. O motivo fica registrado (opcional).', 'Descartar', false);
    if (note === null) return;
    await this.act(group, () => this.moderation.resolveReports(ids(group), 'dismissed', note), 'Denúncia descartada.');
  }

  async takeDown(group: ReportGroup) {
    const note = await this.ask(
      'Tirar anúncio do ar',
      'O anúncio some da vitrine, da busca e da loja. O vendedor vê o aviso em Meus anúncios. Motivo (o vendedor pode ver):',
      'Tirar do ar',
      true
    );
    if (note === null) return;
    await this.act(group, async () => {
      await this.moderation.takeDownProduct(group.targetId, note);
      await this.moderation.resolveReports(ids(group), 'product_removed', note);
    }, 'Anúncio fora do ar.');
  }

  async suspend(group: ReportGroup) {
    const note = await this.ask(
      'Suspender conta do vendedor',
      'A pessoa é desconectada, não consegue mais entrar e todos os anúncios dela saem do ar. Dá para reativar depois. Motivo:',
      'Suspender conta',
      true
    );
    if (note === null) return;
    await this.act(group, async () => {
      await this.moderation.setAccountSuspension(group.sellerId, true, note);
      await this.moderation.resolveReports(ids(group), 'account_suspended', note);
    }, 'Conta suspensa e anúncios fora do ar.');
  }

  async undo(group: ReportGroup) {
    const what = group.resolution === 'account_suspended'
      ? 'reativar a conta e recolocar os anúncios no ar'
      : group.resolution === 'product_removed'
        ? 'recolocar o anúncio no ar'
        : 'reabrir a denúncia';
    const alert = await this.alertCtrl.create({
      header: 'Desfazer decisão?',
      message: `Isso vai ${what}. As denúncias voltam para "Abertas".`,
      buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: 'Desfazer', role: 'confirm' }],
    });
    await alert.present();
    if ((await alert.onDidDismiss()).role !== 'confirm') return;

    await this.act(group, async () => {
      if (group.resolution === 'account_suspended') await this.moderation.setAccountSuspension(group.sellerId, false);
      if (group.resolution === 'product_removed') await this.moderation.restoreProduct(group.targetId);
      await this.moderation.reopenReports(ids(group));
    }, 'Decisão desfeita.');
  }

  // ------------------------------------------------------------------ apoio

  private async ask(header: string, message: string, confirm: string, required: boolean): Promise<string | null> {
    const alert = await this.alertCtrl.create({
      header,
      message,
      inputs: [{ name: 'note', type: 'textarea', placeholder: required ? 'Ex.: venda de produto proibido' : 'Opcional' }],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: confirm,
          role: 'confirm',
          handler: (data: { note?: string }) => !required || !!data?.note?.trim(),
        },
      ],
    });
    await alert.present();
    const { role, data } = await alert.onDidDismiss();
    return role === 'confirm' ? String(data?.values?.note ?? '').trim() : null;
  }

  private async act(group: ReportGroup, action: () => Promise<void>, success: string) {
    if (this.busyKey()) return;
    this.busyKey.set(group.key);
    try {
      await action();
      this.toast(success, 'success');
    } catch (err: any) {
      console.error(err);
      this.toast(err?.message || 'Não foi possível concluir. Tente de novo.', 'danger');
    } finally {
      this.busyKey.set(null);
    }
  }

  private async toast(message: string, color: string) {
    const t = await this.toastCtrl.create({ message, duration: 3000, color, position: 'bottom' });
    await t.present();
  }
}

function ids(group: ReportGroup): string[] {
  return group.reports.map(r => r.id!).filter(Boolean);
}

function stamp(value: unknown): string {
  const date = toDate(value);
  if (!date) return '—';
  return `${formatDay(date, true)}, ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}
