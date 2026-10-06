import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IonicModule, NavController } from '@ionic/angular';
import { Subscription } from 'rxjs';

import { VnIconComponent } from '../../components/vn-icon/vn-icon.component';
import { onAuthUserChanged } from '../../core/auth-state';
import { HelpHit, popularFor, searchHelp } from '../../core/help-content';
import {
  SUPPORT, SUPPORT_STATUS_LABEL, isOpenStatus, protocolTail, relativeTime,
} from '../../core/support-config';
import { SupportTicket } from '../../interfaces/support';
import { SupportService } from '../../services/support.service';

/**
 * "Fale com a Vineon": a porta de entrada do atendimento.
 *
 * Primeiro a Central de ajuda (busca e atalhos), depois o botão de abrir
 * atendimento, e embaixo os atendimentos da pessoa com o que está esperando
 * resposta dela. É o que o item de Minha conta e o botão da Central abrem.
 */
@Component({
  selector: 'app-support',
  templateUrl: './support.page.html',
  styleUrls: ['./support.page.scss'],
  standalone: true,
  imports: [IonicModule, FormsModule, RouterLink, VnIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SupportPage {
  private readonly support = inject(SupportService);
  private readonly navCtrl = inject(NavController);

  readonly info = SUPPORT;
  readonly statusLabel = SUPPORT_STATUS_LABEL;
  readonly tail = protocolTail;

  /** `null` = carregando. */
  readonly tickets = signal<SupportTicket[] | null>(null);
  readonly failed = signal(false);
  readonly query = signal('');

  readonly results = computed<HelpHit[]>(() => (this.query().trim().length >= 3 ? searchHelp(this.query(), 4) : []));
  readonly popular = computed<HelpHit[]>(() => popularFor('buy').slice(0, 4));

  readonly active = computed(() => (this.tickets() ?? []).filter(t => isOpenStatus(t.status)));
  readonly past = computed(() => (this.tickets() ?? []).filter(t => !isOpenStatus(t.status)));
  readonly waitingForYou = computed(() => this.active().filter(t => t.status === 'waiting_customer').length);

  private sub?: Subscription;

  constructor() {
    const stop = onAuthUserChanged(user => {
      this.sub?.unsubscribe();
      this.tickets.set(null);
      this.failed.set(false);
      if (!user) return;
      this.sub = this.support.watchMyTickets(user.uid).subscribe({
        next: list => {
          this.tickets.set(list);
          this.failed.set(false);
        },
        error: err => {
          console.error('[atendimento] não carregou a lista', err);
          this.failed.set(true);
        },
      });
    });
    inject(DestroyRef).onDestroy(() => {
      stop();
      this.sub?.unsubscribe();
    });
  }

  ago(date: Date | null): string {
    return relativeTime(date);
  }

  /** Parâmetros que abrem a pergunta da Central (assunto + pergunta). */
  helpQuery(hit: HelpHit): { assunto: string; pergunta: string } {
    return { assunto: hit.topic.id, pergunta: hit.article.id };
  }

  goBack(): void {
    if (window.history.length > 1) this.navCtrl.back();
    else void this.navCtrl.navigateRoot('/tabs/my-account');
  }
}
