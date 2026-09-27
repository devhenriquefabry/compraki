import { Component, DestroyRef, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertController, IonContent } from '@ionic/angular';

import { CatalogCompetition, CatalogProduct } from 'src/app/interfaces/catalog';
import { Category } from 'src/app/interfaces/category';
import { CatalogService } from 'src/app/services/catalog.service';
import { FirebaseCategories } from 'src/app/services/firebase-categories';

type Step = 'find' | 'confirm' | 'form';

interface StepView {
  key: Step;
  label: string;
}

/**
 * "Anunciar" em passos, no molde do catálogo do Mercado Livre:
 *   1. procurar o produto no catálogo Vineon (ou seguir sem catálogo);
 *   2. conferir a ficha ("É este o produto que você vende?");
 *   3. preencher só o que é do vendedor: condição, preço, estoque e entrega.
 *
 * `?catalog=<id>` abre direto no passo 2 (usado pelo "Vender um igual" da
 * ficha de um anúncio feito pelo catálogo).
 */
@Component({
  selector: 'app-upload-product',
  templateUrl: './upload-product.page.html',
  styleUrls: ['./upload-product.page.scss'],
  standalone: false
})
export class UploadProductPage implements OnInit {
  private readonly catalog = inject(CatalogService);
  private readonly categoriesService = inject(FirebaseCategories);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly alertCtrl = inject(AlertController);
  private readonly destroyRef = inject(DestroyRef);

  private readonly content = viewChild(IonContent);

  readonly step = signal<Step>('find');
  readonly catalogProduct = signal<CatalogProduct | null>(null);
  readonly competition = signal<CatalogCompetition | null>(null);
  /** Troca a cada novo formulário, para ele nascer limpo. */
  readonly formKey = signal(0);
  readonly categories = signal<Category[]>([]);

  readonly steps = computed<StepView[]>(() => {
    const manual = this.step() === 'form' && !this.catalogProduct();
    return manual
      ? [{ key: 'find', label: 'Produto' }, { key: 'form', label: 'Detalhes do anúncio' }]
      : [{ key: 'find', label: 'Produto' }, { key: 'confirm', label: 'Conferir ficha' }, { key: 'form', label: 'Preço e estoque' }];
  });

  readonly stepIndex = computed(() => this.steps().findIndex(s => s.key === this.step()));

  readonly categoryLabel = computed(() => {
    const product = this.catalogProduct();
    const cat = this.categories().find(c => c.id === product?.categoryId);
    if (!cat) return '';
    const sub = cat.subcategories?.find(s => s.id === product?.subcategoryId);
    return sub ? `${cat.name} › ${sub.name}` : cat.name;
  });

  ngOnInit() {
    this.categoriesService.getAll().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(cats => this.categories.set(cats));

    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const id = params.get('catalog');
      if (id) void this.openCatalogById(id);
    });
  }

  private async openCatalogById(id: string) {
    try {
      const product = await this.catalog.getById(id);
      if (product && product.status === 'active') this.onPicked(product);
    } catch (err) {
      console.warn('[anunciar] produto do catálogo', err);
    } finally {
      // Tira o parâmetro para "voltar" não reabrir o mesmo produto.
      void this.router.navigate([], { queryParams: { catalog: null }, queryParamsHandling: 'merge', replaceUrl: true });
    }
  }

  // ------------------------------------------------------------ passos

  onPicked(product: CatalogProduct) {
    this.catalogProduct.set(product);
    this.competition.set(null);
    this.go('confirm');
  }

  backToFind() {
    this.go('find');
  }

  startWithCatalog(competition: CatalogCompetition | null) {
    this.competition.set(competition);
    this.formKey.update(k => k + 1);
    this.go('form');
  }

  startManual() {
    this.catalogProduct.set(null);
    this.competition.set(null);
    this.formKey.update(k => k + 1);
    this.go('form');
  }

  async changeProduct() {
    const alert = await this.alertCtrl.create({
      header: 'Trocar o produto?',
      message: 'Você volta para a busca e o que preencheu neste anúncio é descartado.',
      buttons: [
        { text: 'Continuar aqui', role: 'cancel' },
        { text: 'Trocar produto', role: 'confirm' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role === 'confirm') this.go('find');
  }

  /** Clique na trilha de passos: só volta, nunca pula para frente. */
  goToStep(key: Step, index: number) {
    if (index >= this.stepIndex()) return;
    if (this.step() === 'form') {
      void this.changeProduct();
      return;
    }
    this.go(key);
  }

  /** Anúncio publicado: a aba "Anunciar" volta ao começo para o próximo. */
  onPublished() {
    this.catalogProduct.set(null);
    this.competition.set(null);
    this.step.set('find');
  }

  private go(step: Step) {
    this.step.set(step);
    void this.content()?.scrollToTop(0);
  }
}
