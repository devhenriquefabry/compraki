import { Component } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { IonTabs, IonTabBar, IonTabButton } from '@ionic/angular/standalone';
import { inject } from '@angular/core';
import { StorefrontDataService } from '../services/storefront-data.service';
import { NotificationCenterService } from '../services/notification-center.service';
import { VN_ICONS } from '../core/vn-icons';


/**
 * Barra inferior do celular: Início, Anunciar, Carrinho e Conta. Tudo o que
 * antes ficava num painel "Menu" (compras, salvos, mensagens, avisos, vendas,
 * ajuda, sair) mora na tela Conta.
 *
 * NÃO usar `ChangeDetectionStrategy.OnPush` aqui. Este componente é o ancestral
 * de todas as telas das abas (Início, Conta, Carrinho...): com OnPush o Angular
 * pula a árvore inteira abaixo dele enquanto ele não for marcado como sujo, e
 * dado do Firestore que chega depois da primeira renderização (rede lenta de
 * celular) não marca nada — a home ficava para sempre no esqueleto de
 * carregamento, até um toque na tela. O template daqui é todo de signals e
 * custa o mesmo no modo padrão.
 */
@Component({
  selector: 'app-tabs',
  templateUrl: 'tabs.page.html',
  styleUrls: ['tabs.page.scss'],
  standalone: true,
  imports: [IonTabs, IonTabBar, IonTabButton],
})
export class TabsPage {
  private readonly storefront = inject(StorefrontDataService);

  readonly icons = VN_ICONS;

  /** Avisos não lidos: ponto no ícone Conta. */
  readonly unread = inject(NotificationCenterService).unread;

  readonly cartCount = toSignal(this.storefront.cartCount$, { initialValue: 0 });
}
