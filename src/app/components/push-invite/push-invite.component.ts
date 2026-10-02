import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { ModalController } from '@ionic/angular';

import { enablePush } from '../../core/push';
import { VnIconComponent } from '../vn-icon/vn-icon.component';

/**
 * Convite para ativar as notificações — aparece UMA vez no app instalado
 * (PWA), alguns segundos depois de abrir, enquanto a permissão ainda não foi
 * pedida. "Agora não" adia 7 dias. Aberto por `NotificationCenterService`.
 *
 * O pedido de permissão do sistema só sai no toque em "Ativar" (o iPhone
 * exige gesto do usuário, e pedir de surpresa faz a pessoa negar).
 */
@Component({
  selector: 'app-push-invite',
  standalone: true,
  imports: [VnIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pi">
      <span class="pi-grip" aria-hidden="true"></span>
      <span class="pi-mark" aria-hidden="true"><vn-icon name="bell" /></span>
      <h2 id="pi-title">Ative as notificações</h2>
      <p>Saiba na hora o que acontece com suas compras e vendas, mesmo com o app fechado.</p>

      <ul class="pi-list">
        <li><vn-icon name="wallet" /><span>Pagamento aprovado</span></li>
        <li><vn-icon name="truck" /><span>Pedido a caminho e entregue</span></li>
        <li><vn-icon name="bag" /><span>Venda nova na sua loja</span></li>
        <li><vn-icon name="chat" /><span>Mensagem de comprador ou loja</span></li>
      </ul>

      @if (denied()) {
        <p class="pi-note" role="status">As notificações ficaram bloqueadas. Dá para liberar depois nos ajustes do celular.</p>
      }

      <button type="button" class="pi-btn pi-btn--lime" (click)="activate()" [disabled]="busy()">
        {{ busy() ? 'Ativando…' : 'Ativar notificações' }}
      </button>
      <button type="button" class="pi-btn pi-btn--ghost" (click)="later()">Agora não</button>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .pi {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 10px 22px calc(18px + var(--ion-safe-area-bottom, 0px));
      font-family: var(--vn-font-body, 'Nunito', system-ui, sans-serif);
      color: #0B1623;
      text-align: center;
      background: #fff;
    }
    .pi-grip { width: 38px; height: 5px; border-radius: 3px; background: #DDE2E8; margin-bottom: 18px; }
    .pi-mark {
      display: grid; place-items: center;
      width: 64px; height: 64px; border-radius: 50%;
      background: #0B1623; color: #D8F51F;
      font-size: 30px;
      box-shadow: 0 0 0 6px rgba(216, 245, 31, 0.35);
    }
    h2 {
      margin: 16px 0 6px;
      font-family: var(--vn-font-display, 'Sora', 'Nunito', system-ui, sans-serif);
      font-size: 21px; font-weight: 700; letter-spacing: -0.02em;
    }
    p { margin: 0; max-width: 330px; font-size: 15px; line-height: 1.5; color: #3A4452; }
    .pi-list {
      list-style: none; margin: 18px 0 20px; padding: 0;
      width: 100%; max-width: 340px;
      display: grid; gap: 2px; text-align: left;
    }
    .pi-list li {
      display: flex; align-items: center; gap: 12px;
      padding: 9px 12px; border-radius: 12px;
      font-size: 15px; font-weight: 700;
      background: #F4F6F8;
    }
    .pi-list vn-icon { font-size: 20px; flex: none; }
    .pi-note { margin: -6px 0 14px; font-size: 13.5px; color: #9A3412; font-weight: 700; }
    .pi-btn {
      width: 100%; max-width: 340px; min-height: 50px;
      border: 0; border-radius: 14px;
      font: 800 16px var(--vn-font-body, 'Nunito', system-ui, sans-serif);
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }
    .pi-btn--lime { background: #D8F51F; color: #0B1623; }
    .pi-btn--lime:active { filter: brightness(0.95); }
    .pi-btn--lime:disabled { opacity: 0.7; }
    .pi-btn--ghost { margin-top: 4px; background: none; color: #3A4452; }
    .pi-btn:focus-visible { outline: 2px solid #0B1623; outline-offset: 2px; }
  `],
})
export class PushInviteComponent {
  private readonly modalCtrl = inject(ModalController);

  readonly uid = input.required<string>();
  readonly busy = signal(false);
  readonly denied = signal(false);

  activate(): void {
    this.busy.set(true);
    // Sem await antes: o pedido de permissão precisa do toque "quente".
    enablePush(this.uid())
      .then(status => {
        if (status === 'granted') void this.modalCtrl.dismiss(null, 'granted');
        else if (status === 'denied') this.denied.set(true);
      })
      .catch(err => {
        console.error('[avisos] ativar push', err);
        void this.modalCtrl.dismiss(null, 'error');
      })
      .finally(() => this.busy.set(false));
  }

  later(): void {
    void this.modalCtrl.dismiss(null, 'later');
  }
}
