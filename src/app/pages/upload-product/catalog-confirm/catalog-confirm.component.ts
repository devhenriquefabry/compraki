import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { IonicModule } from '@ionic/angular';

import { getCurrentUser } from '../../../core/auth-state';
import { catalogCode, catalogPhotos, packageSummary } from '../../../core/catalog';
import { illustrationUrl } from '../../../core/catalog-illustrations';
import { defaultPhotoOption, hasOptionPhotos, photosForOption } from '../../../core/product-variants';
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
  readonly allPhotos = computed(() => catalogPhotos(this.product()));
  readonly illustrative = computed(() => !this.allPhotos().length);
  /** Cor (1º atributo) escolhida: a galeria mostra só as fotos dela, como na página do produto. */
  readonly selectedValue = signal<string | null>(null);
  /** Só vale tocar na cor quando alguma tem foto própria — senão a galeria não muda. */
  readonly pickable = computed(() => {
    const p = this.product();
    return !this.illustrative() && hasOptionPhotos({ galleries: p.variantPhotos, legacy: p.variantImages });
  });
  readonly photos = computed(() => {
    if (this.illustrative()) return [illustrationUrl(this.product())];
    const p = this.product();
    return photosForOption({
      all: this.allPhotos(),
      general: p.photos || [],
      galleries: p.variantPhotos,
      legacy: p.variantImages
    }, this.selectedValue());
  });
  readonly currentPhoto = computed(() => this.photos()[this.photoIndex()] ?? this.photos()[0] ?? null);
  readonly specs = computed(() => {
    const specs = this.product().specs;
    return this.allSpecs() ? specs : specs.slice(0, SPECS_PREVIEW);
  });
  readonly hiddenSpecs = computed(() => Math.max(0, this.product().specs.length - SPECS_PREVIEW));

  ngOnInit() {
    const p = this.product();
    this.selectedValue.set(defaultPhotoOption(p.variantAttributes, { galleries: p.variantPhotos, legacy: p.variantImages }));
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

  /** Tocar numa cor troca a galeria para as fotos dela, a partir da 1ª. */
  previewValue(value: string) {
    this.selectedValue.set(value);
    this.photoIndex.set(0);
  }

  imageFor(value: string): string | null {
    const p = this.product();
    return p.variantPhotos?.[value]?.[0] || p.variantImages[value] || null;
  }

  confirm() {
    this.accept.emit(this.competition());
  }
}
