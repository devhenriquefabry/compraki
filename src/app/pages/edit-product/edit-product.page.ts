import { Component, DestroyRef, HostListener, ViewChild, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertController, IonContent, NavController } from '@ionic/angular';
import { of } from 'rxjs';
import { switchMap } from 'rxjs/operators';

import { waitForAuthUser } from 'src/app/core/auth-state';
import { Product } from 'src/app/interfaces/product';
import { FirebaseProducts } from 'src/app/services/firebase-products';
import { EDIT_SECTIONS, EditProductFormComponent, EditSection } from './edit-product-form/edit-product-form.component';

/**
 * Editar anúncio: topo azul-noite com atalhos para cada seção do formulário,
 * que acompanham a rolagem. O formulário recebe o anúncio uma vez só — antes
 * cada atualização do documento (um "salvar" de outra aba, um contador de
 * salvos) reescrevia o que a pessoa estava digitando.
 *
 * Sem id na rota não há o que editar: volta para Meus anúncios.
 */
@Component({
  selector: 'app-edit-product',
  templateUrl: './edit-product.page.html',
  styleUrls: ['./edit-product.page.scss'],
  standalone: false,
})
export class EditProductPage {
  private readonly fbProducts = inject(FirebaseProducts);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly navCtrl = inject(NavController);
  private readonly alertCtrl = inject(AlertController);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild(IonContent) content?: IonContent;
  @ViewChild(EditProductFormComponent) form?: EditProductFormComponent;

  readonly sections = EDIT_SECTIONS;
  activeSection: EditSection = 'fotos';

  loading = true;
  product: Product | null = null;
  notOwner = false;
  productId = '';

  constructor() {
    const sub = this.route.paramMap.pipe(
      switchMap(params => {
        this.productId = params.get('id') || '';
        this.loading = true;
        this.product = null;
        return this.productId ? this.fbProducts.getById(this.productId) : of(null);
      }),
    ).subscribe(async found => {
      if (!this.productId) {
        void this.navCtrl.navigateRoot('/my-products', { replaceUrl: true });
        return;
      }
      // Só a primeira leitura vai para o formulário (ver comentário da classe).
      if (this.product && found && found.id === this.product.id) return;
      const user = await waitForAuthUser();
      this.notOwner = !!found && found.sellerId !== user?.uid;
      this.product = found;
      this.loading = false;
    });
    this.destroyRef.onDestroy(() => sub.unsubscribe());
  }

  /** Recarregar ou fechar a aba com alteração pendente pede confirmação do navegador. */
  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent) {
    if (this.form?.changed) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  async goBack() {
    if (this.form?.changed) {
      const alert = await this.alertCtrl.create({
        header: 'Sair sem salvar?',
        message: 'As alterações que você fez neste anúncio vão se perder.',
        buttons: [
          { text: 'Continuar editando', role: 'cancel' },
          { text: 'Sair sem salvar', role: 'destructive' },
        ],
      });
      await alert.present();
      if ((await alert.onDidDismiss()).role !== 'destructive') return;
      this.form.changed = false;
    }
    this.leave();
  }

  leave() {
    if (window.history.length > 1) this.navCtrl.back();
    else this.navCtrl.navigateRoot(this.productId ? `/product-admin/${this.productId}` : '/my-products');
  }

  onSaved() {
    void this.navCtrl.navigateBack(`/product-admin/${this.productId}`, { replaceUrl: true });
  }

  openListing() {
    void this.router.navigate(['/product-details', this.productId]);
  }

  // ------------------------------------------------------------ seções

  async jump(id: EditSection) {
    const el = document.getElementById(`ef-${id}`);
    const content = this.content;
    if (!el || !content) return;
    const scroller = await content.getScrollElement();
    const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 12;
    this.activeSection = id;
    await content.scrollToPoint(0, Math.max(0, top), 350);
  }

  /** A aba ativa é a última seção cujo topo já passou do alto da tela. */
  async onScroll() {
    const scroller = await this.content?.getScrollElement();
    if (!scroller) return;
    const base = scroller.getBoundingClientRect().top + 80;
    let current: EditSection = this.sections[0].id;
    for (const s of this.sections) {
      const el = document.getElementById(`ef-${s.id}`);
      if (el && el.getBoundingClientRect().top <= base) current = s.id;
    }
    if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4) {
      current = this.sections[this.sections.length - 1].id;
    }
    this.activeSection = current;
  }
}
