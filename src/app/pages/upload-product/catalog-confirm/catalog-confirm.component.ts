import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { IonicModule } from '@ionic/angular';

import { getCurrentUser } from '../../../core/auth-state';
import { catalogCode, packageSummary } from '../../../core/catalog';
import { illustrationUrl } from '../../../core/catalog-illustrations';
import { CatalogCompetition, CatalogProduct } from '../../../interfaces/catalog';
import { CatalogService } from '../../../services/catalog.service';

const SPECS_PREVIEW = 6;

/**
 * Passo 2 do "Anunciar" com catálogo: "É este o produto que você vende?".
 * Mostra fotos, opções, ficha técnica e quantas lojas já vendem, antes de o
 * vendedor aceitar a ficha e seguir para preço e estoque.
 */
@Component({
  selector: 'app-catalog-confirm',
  templateUrl: './catalog-confirm.component.html',
  styleUrls: ['./catalog-confirm.component.scss'],
  standalone: true,
  imports: [IonicModule, CurrencyPipe],
})
export class CatalogConfirmComponent implements OnInit {
  private readonly catalog = inject(CatalogService);

  readonly product = input.required<CatalogProduct>();
  readonly categoryLabel = input('');

  readonly back = output<void>();
  readonly accept = output<CatalogCompetition | null>();

  readonly photoIndex = signal(0);
  readonly allSpecs = signal(false);
  readonly competition = signal<CatalogCompetition | null>(null);

  readonly code = computed(() => catalogCode(this.product().id));
  readonly packageText = computed(() => packageSummary(this.product()));
  /** Sem foto oficial, a galeria mostra a imagem ilustrativa do tipo de produto. */
  readonly illustrative = computed(() => !this.product().photos.length);
  readonly photos = computed(() => (this.illustrative() ? [illustrationUrl(this.product())] : this.product().photos));
  readonly currentPhoto = computed(() => this.photos()[this.photoIndex()] ?? this.photos()[0] ?? null);
  readonly specs = computed(() => {
    const specs = this.product().specs;
    return this.allSpecs() ? specs : specs.slice(0, SPECS_PREVIEW);
  });
  readonly hiddenSpecs = computed(() => Math.max(0, this.product().specs.length - SPECS_PREVIEW));

  ngOnInit() {
    void this.loadCompetition();
  }

  private async loadCompetition() {
    const id = this.product().id;
    if (!id) return;
    try {
      this.competition.set(await this.catalog.competition(id, getCurrentUser()?.uid));
    } catch (err) {
      console.warn('[anunciar] concorrência do catálogo', err);
    }
  }

  showPhoto(index: number) {
    this.photoIndex.set(index);
  }

  /** Ao tocar numa cor com foto, a galeria mostra aquela foto. */
  previewValue(value: string) {
    const url = this.product().variantImages[value];
    if (!url) return;
    const index = this.photos().indexOf(url);
    if (index >= 0) this.photoIndex.set(index);
  }

  imageFor(value: string): string | null {
    return this.product().variantImages[value] || null;
  }

  confirm() {
    this.accept.emit(this.competition());
  }
}
