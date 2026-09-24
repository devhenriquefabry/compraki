import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController, ToastController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { checkmarkCircle, closeOutline, flagOutline, shieldCheckmarkOutline } from 'ionicons/icons';

import { REPORT_REASONS, ReportReason, ReportTargetType } from '../../interfaces/content-report';
import { ModerationService } from '../../services/moderation.service';

/**
 * Denunciar anúncio ou vendedor. Abrir com `ModalController`:
 *
 *   modalCtrl.create({ component: ReportModalComponent, componentProps: { targetType: 'product', ... } })
 *
 * Quem abre garante que há conta logada (`requireAccount`).
 */
@Component({
  selector: 'app-report-modal',
  templateUrl: './report-modal.component.html',
  styleUrls: ['./report-modal.component.scss'],
  standalone: true,
  imports: [IonicModule, FormsModule],
})
export class ReportModalComponent implements OnInit {
  @Input({ required: true }) targetType!: ReportTargetType;
  @Input({ required: true }) targetId!: string;
  @Input({ required: true }) sellerId!: string;
  @Input({ required: true }) targetName!: string;
  @Input() targetPhoto: string | null = null;

  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);
  private readonly moderation = inject(ModerationService);

  readonly checking = signal(true);
  readonly already = signal(false);
  readonly sending = signal(false);
  readonly sent = signal(false);
  readonly error = signal('');

  reason: ReportReason | null = null;
  details = '';

  constructor() {
    addIcons({ checkmarkCircle, closeOutline, flagOutline, shieldCheckmarkOutline });
  }

  get reasons() {
    return REPORT_REASONS[this.targetType] ?? REPORT_REASONS.product;
  }

  get title(): string {
    return this.targetType === 'product' ? 'Denunciar anúncio' : 'Denunciar vendedor';
  }

  get needsDetails(): boolean {
    return this.reason === 'other';
  }

  get canSubmit(): boolean {
    if (!this.reason || this.sending()) return false;
    return !this.needsDetails || this.details.trim().length >= 10;
  }

  async ngOnInit() {
    this.already.set(await this.moderation.alreadyReported(this.targetType, this.targetId));
    this.checking.set(false);
  }

  close() {
    void this.modalCtrl.dismiss(this.sent(), this.sent() ? 'sent' : 'cancel');
  }

  async submit() {
    if (!this.canSubmit || !this.reason) return;
    this.sending.set(true);
    this.error.set('');
    try {
      await this.moderation.submitReport({
        targetType: this.targetType,
        targetId: this.targetId,
        sellerId: this.sellerId,
        targetName: this.targetName,
        targetPhoto: this.targetPhoto,
        reason: this.reason,
        details: this.details,
      });
      this.sent.set(true);
    } catch (err: any) {
      console.error('Falha ao enviar denúncia', err);
      if (err?.code === 'permission-denied' && await this.moderation.alreadyReported(this.targetType, this.targetId)) {
        this.already.set(true);
      } else {
        this.error.set('Não foi possível enviar agora. Tente de novo em instantes.');
      }
    } finally {
      this.sending.set(false);
    }
  }
}
