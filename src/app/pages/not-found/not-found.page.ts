import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { IonicModule, NavController } from '@ionic/angular';

import { VineonLogoComponent } from '../../components/vineon-logo/vineon-logo.component';

/**
 * Página para endereço que não existe (link antigo, anúncio apagado,
 * digitação). Antes a rota desconhecida abria uma tela em branco. Oferece o
 * caminho mais provável de volta: buscar, ir para o início ou pedir ajuda.
 */
@Component({
  selector: 'app-not-found',
  templateUrl: './not-found.page.html',
  styleUrls: ['./not-found.page.scss'],
  standalone: true,
  imports: [FormsModule, IonicModule, RouterModule, VineonLogoComponent],
})
export class NotFoundPage {
  private readonly router = inject(Router);
  private readonly navCtrl = inject(NavController);

  readonly path = this.router.url.split('?')[0];
  term = '';

  search() {
    const q = this.term.trim();
    this.navCtrl.navigateRoot('/tabs/tab2', q ? { queryParams: { q } } : undefined);
  }

  goHome() {
    this.navCtrl.navigateRoot('/tabs/tab2');
  }
}
