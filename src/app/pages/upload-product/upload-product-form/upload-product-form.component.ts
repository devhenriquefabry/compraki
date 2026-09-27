import { Component, EventEmitter, Input, OnDestroy, OnInit, Output, inject } from '@angular/core';
import { Router } from '@angular/router';
import {  FormControl, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Product, ProductSku, ProductSpec, ProductVariantAttribute } from 'src/app/interfaces/product';
import { ProductSpecsEditorComponent, cleanSpecs } from 'src/app/components/product-specs-editor/product-specs-editor.component';
import { ProductVariantsEditorComponent } from 'src/app/components/product-variants-editor/product-variants-editor.component';
import { cleanVariantImages, cleanVariants, totalVariantStock } from 'src/app/core/product-variants';
import { FirebaseProducts } from 'src/app/services/firebase-products';
import { FirebaseCategories } from 'src/app/services/firebase-categories';
import { Category, Subcategory } from 'src/app/interfaces/category';
import { NgFor, NgIf, AsyncPipe, CurrencyPipe } from '@angular/common';
import { Observable, Subscription } from 'rxjs';
import { ProductNameGuardService } from 'src/app/services/product-name-guard.service';
import { FeedbackModalComponent } from 'src/app/components/feedback-modal/feedback-modal.component';
import { LoadingSpinnerOverlayComponent } from 'src/app/components/loading-spinner-overlay/loading-spinner-overlay.component';
import { WhatsappInstancesService } from 'src/app/services/whatsapp-instances.service';
import { CatalogCompetition, CatalogProduct } from 'src/app/interfaces/catalog';
import { catalogCode, cleanCatalogSpecs, normalizeText, packageSummary } from 'src/app/core/catalog';

@Component({
  selector: 'app-upload-product-form',
  templateUrl: './upload-product-form.component.html',
  styleUrls: ['./upload-product-form.component.scss'],
  imports: [IonicModule, ReactiveFormsModule, FormsModule, NgFor, NgIf, AsyncPipe, CurrencyPipe, FeedbackModalComponent, LoadingSpinnerOverlayComponent, ProductSpecsEditorComponent, ProductVariantsEditorComponent ],
  standalone: true
})
export class UploadProductFormComponent  implements OnInit, OnDestroy {
  private readonly nameGuard = inject(ProductNameGuardService);
  private nameGuardSub?: Subscription;


  /**
   * Produto do catálogo Vineon escolhido no passo anterior. Com ele o anúncio
   * nasce com título, categoria, fotos, ficha técnica, opções e medidas; o
   * vendedor informa condição, preço, estoque e entrega.
   */
  @Input() catalogProduct: CatalogProduct | null = null;
  /** Lojas que já vendem o produto do catálogo (vem do passo de conferência). */
  @Input() competition: CatalogCompetition | null = null;
  @Output() changeProduct = new EventEmitter<void>();
  @Output() published = new EventEmitter<string>();

  public isFormValid : boolean = false;
  public selectedPhotos: string[] = [];
  /** Arquivo de cada foto, na mesma ordem; `null` = foto do catálogo (já é URL). */
  private filesToUpload: (File | null)[] = [];
  /** Ficha técnica do catálogo: fixa, entra antes das informações extras. */
  public catalogSpecs: ProductSpec[] = [];
  private catalogPhotoSet = new Set<string>();

  // ===== VARIAÇÕES (cor, tamanho...) =====
  public hasVariants = false;
  public variantAttributes: ProductVariantAttribute[] = [];
  public variantSkus: Record<string, ProductSku> = {};
  public variantImages: Record<string, string> = {};
  public categories$!: Observable<Category[]>;
  public availableSubcategories: Subcategory[] = [];
  private allCategories: Category[] = [];

  public conditionOptions: { value: 'novo' | 'usado-como-novo' | 'usado-bom' | 'usado-aceitavel'; label: string; hint: string }[] = [
    { value: 'novo', label: 'Novo', hint: 'Lacrado, nunca usado' },
    { value: 'usado-como-novo', label: 'Como novo', hint: 'Usado poucas vezes, sem marcas' },
    { value: 'usado-bom', label: 'Bom estado', hint: 'Uso normal, pequenos sinais' },
    { value: 'usado-aceitavel', label: 'Aceitável', hint: 'Funciona bem, com desgaste' },
  ];

  public shippingOptions: { value: 'Frete Grátis' | 'A combinar' | 'Entrega Expressa'; label: string; hint: string; icon: string }[] = [
    { value: 'Frete Grátis', label: 'Frete grátis', hint: 'Você assume o custo do envio', icon: 'gift-outline' },
    { value: 'A combinar', label: 'A combinar', hint: 'Combine o frete com o comprador', icon: 'chatbubbles-outline' },
    { value: 'Entrega Expressa', label: 'Expressa', hint: 'Envio prioritário', icon: 'flash-outline' },
  ];
  public availablePaymentMethods: ('PIX' | 'CARTÃO' | 'DINHEIRO')[] = ['PIX', 'CARTÃO', 'DINHEIRO'];

  /** Campos obrigatórios do formulário, usados só para calcular o progresso exibido ao vendedor. */
  private readonly requiredFields = ['name', 'condition', 'price', 'stock', 'description', 'categoryIds', 'shipping', 'paymentMethods', 'weight', 'width', 'height', 'length'];

  // Feedback modal
  public showFeedback = false;
  public feedbackType: 'success' | 'error' = 'success';
  public feedbackTitle = '';
  public feedbackMessage = '';
  public isLoading = false;

  submitProductForm = new FormGroup({
    id: new FormControl(''),
    photoURL: new FormControl<string[]>([]),
    name: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    condition: new FormControl('novo', [Validators.required]),
    price: new FormControl<number | null>(null, [Validators.required]),
    stock: new FormControl<number>(1, [Validators.required]),
    acceptOffers: new FormControl(true),
    description: new FormControl('', [Validators.required]),
    specs: new FormControl<ProductSpec[]>([]),
    categoryIds: new FormControl<string[]>([], [Validators.required, Validators.minLength(1)]),
    subcategoryIds: new FormControl<string[]>([]),
    priceDiscounted: new FormControl<number | null>(null),
    shipping: new FormControl<'Frete Grátis' | 'A combinar' | 'Entrega Expressa'>('A combinar', [Validators.required]),
    paymentMethods: new FormControl<('PIX' | 'CARTÃO' | 'DINHEIRO')[]>(['PIX'], [Validators.required, Validators.minLength(1)]),
    
    // Novos campos de dimensões
    weight: new FormControl<number | null>(null, [Validators.required, Validators.min(0.1)]),
    width: new FormControl<number | null>(null, [Validators.required, Validators.min(1), Validators.max(100)]),
    height: new FormControl<number | null>(null, [Validators.required, Validators.min(1), Validators.max(100)]),
    length: new FormControl<number | null>(null, [Validators.required, Validators.min(1), Validators.max(100)])
  });

  constructor(
    private servicoFirebase : FirebaseProducts,
    private servicoCategorias : FirebaseCategories,
    private router : Router,
    private whatsappService: WhatsappInstancesService
  ) { }

  ngOnInit() {
    // Termos proibidos pelo admin: aviso na hora e botão de publicar travado.
    const nameControl = this.submitProductForm.controls.name;
    nameControl.addValidators(this.nameGuard.validator());
    nameControl.updateValueAndValidity({ emitEvent: false });
    this.nameGuardSub = this.nameGuard.watch(nameControl);

    this.categories$ = this.servicoCategorias.getAll();
    this.categories$.subscribe(cats => {
      this.allCategories = cats;
      this.refreshCatalogCategory();
    });

    this.submitProductForm.statusChanges.subscribe(status => {
      this.isFormValid = status === 'VALID';
    });

    // Lógica de cascata para subcategorias
    this.submitProductForm.get('categoryIds')?.valueChanges.subscribe(catIds => {
      if (catIds && catIds.length > 0) {
        const selectedCat = this.allCategories.find(c => c.id === catIds[0]);
        this.availableSubcategories = selectedCat?.subcategories || [];
      } else {
        this.availableSubcategories = [];
      }
      this.submitProductForm.patchValue({ subcategoryIds: [] });
    });

    if (this.catalogProduct) this.applyCatalog(this.catalogProduct);
  }

  // ===== CATÁLOGO =====
  public catalogCategoryLabel = '';

  /** Preenche o formulário com a ficha do catálogo. */
  private applyCatalog(c: CatalogProduct) {
    // Categoria antes: a troca de categoria zera a subcategoria.
    this.submitProductForm.patchValue({ categoryIds: [c.categoryId] });
    this.submitProductForm.patchValue({
      name: c.title,
      subcategoryIds: c.subcategoryId ? [c.subcategoryId] : [],
      description: c.description || '',
      condition: 'novo',
      weight: c.weight,
      width: c.width,
      height: c.height,
      length: c.length,
      specs: [],
    });

    this.catalogSpecs = cleanCatalogSpecs(c.specs);
    this.selectedPhotos = [...c.photos];
    this.filesToUpload = c.photos.map(() => null);
    this.catalogPhotoSet = new Set(c.photos);

    // Opções vêm do catálogo; o vendedor marca as que tem.
    this.hasVariants = c.variantAttributes.length > 0;
    this.variantAttributes = c.variantAttributes.map(a => ({ name: a.name, values: [] }));
    this.variantSkus = {};
    this.variantImages = { ...c.variantImages };
    this.refreshCatalogCategory();
  }

  private refreshCatalogCategory() {
    const c = this.catalogProduct;
    if (!c) return;
    const cat = this.allCategories.find(x => x.id === c.categoryId);
    const sub = cat?.subcategories?.find(x => x.id === c.subcategoryId);
    this.catalogCategoryLabel = cat ? (sub ? `${cat.name} › ${sub.name}` : cat.name) : '';
  }

  get catalogCodeLabel(): string {
    return catalogCode(this.catalogProduct?.id);
  }

  get catalogPackage(): string {
    return this.catalogProduct ? packageSummary(this.catalogProduct) : '';
  }

  /** Extras que fazem sentido num anúncio do catálogo (o resto já está na ficha). */
  get catalogExtraLabels(): string[] {
    const taken = new Set(this.catalogSpecs.map(spec => normalizeText(spec.label)));
    return ['Garantia', 'Itens inclusos', 'Nota fiscal', 'Brinde'].filter(label => !taken.has(normalizeText(label)));
  }

  isCatalogPhoto(photo: string): boolean {
    return this.catalogPhotoSet.has(photo);
  }

  /** Nome da 1ª opção do catálogo sem nenhuma marcada (ex.: "Cor"), ou null. */
  get missingCatalogOption(): string | null {
    const attrs = this.catalogProduct?.variantAttributes ?? [];
    const empty = attrs.find((_, i) => !this.variantAttributes[i]?.values.length);
    return empty?.name ?? null;
  }

  /** Ficha do catálogo sem fotos: o vendedor precisa enviar ao menos uma. */
  get missingCatalogPhoto(): boolean {
    return !!this.catalogProduct && this.selectedPhotos.length === 0;
  }

  get canPublish(): boolean {
    return this.submitProductForm.valid && !this.missingCatalogOption && !this.missingCatalogPhoto;
  }

  get completionPercent(): number {
    const done = this.requiredFields.filter(name => this.submitProductForm.get(name)?.valid).length;
    // Com catálogo, escolher as opções (cor, armazenamento...) também conta.
    const needsOptions = !!this.catalogProduct?.variantAttributes.length;
    const total = this.requiredFields.length + (needsOptions ? 1 : 0);
    const extra = needsOptions && !this.missingCatalogOption ? 1 : 0;
    return Math.round(((done + extra) / total) * 100);
  }

  get conditionLabel(): string {
    const value = this.submitProductForm.get('condition')?.value;
    return this.conditionOptions.find(c => c.value === value)?.label || 'Novo';
  }

  get discountPercent(): number | null {
    const price = this.submitProductForm.get('price')?.value;
    const promo = this.submitProductForm.get('priceDiscounted')?.value;
    if (!price || !promo || promo >= price) return null;
    return Math.round((1 - promo / price) * 100);
  }

  selectCategory(catId: string) {
    this.submitProductForm.patchValue({ categoryIds: [catId] });
  }

  toggleSubcategory(subId: string) {
    const current = this.submitProductForm.get('subcategoryIds')?.value || [];
    const idx = current.indexOf(subId);
    if (idx > -1) {
      current.splice(idx, 1);
    } else {
      current.push(subId);
    }
    this.submitProductForm.patchValue({ subcategoryIds: [...current] });
  }

  togglePaymentMethod(method: 'PIX' | 'CARTÃO' | 'DINHEIRO') {
    const current = this.submitProductForm.get('paymentMethods')?.value || [];
    const idx = current.indexOf(method);
    if (idx > -1) {
      if (current.length > 1) { // Garante pelo menos um método
        current.splice(idx, 1);
      }
    } else {
      current.push(method);
    }
    this.submitProductForm.patchValue({ paymentMethods: [...current] });
  }

  onFileSelected(event: any) {
    const files: File[] = Array.from(event.target.files || []);
    event.target.value = '';
    // Lê todas antes de acrescentar: prévia e arquivo ficam sempre na mesma ordem.
    Promise.all(files.map(file => new Promise<string>(resolve => {
      const reader = new FileReader();
      reader.onload = (e: any) => resolve(e.target.result);
      reader.readAsDataURL(file);
    }))).then(previews => {
      this.selectedPhotos.push(...previews);
      this.filesToUpload.push(...files);
    });
  }

  removePhoto(index: number) {
    this.selectedPhotos.splice(index, 1);
    this.filesToUpload.splice(index, 1);
  }

  // ===== REORDER PHOTOS (INSTAGRAM STYLE) =====
  public isReorderModalOpen = false;
  public reorderIndices: number[] = [];

  openReorderModal() {
    this.reorderIndices = [];
    this.isReorderModalOpen = true;
  }

  closeReorderModal() {
    this.isReorderModalOpen = false;
    this.reorderIndices = [];
  }

  toggleReorder(index: number) {
    const idx = this.reorderIndices.indexOf(index);
    if (idx > -1) {
      // Se for o último selecionado, desseleciona para permitir correção
      if (idx === this.reorderIndices.length - 1) {
        this.reorderIndices.pop();
      }
    } else {
      // Só adiciona se clicar na ordem certa
      this.reorderIndices.push(index);
    }
  }

  getReorderNumber(index: number): number | null {
    const idx = this.reorderIndices.indexOf(index);
    return idx > -1 ? idx + 1 : null;
  }

  confirmReorder() {
    if (this.reorderIndices.length !== this.selectedPhotos.length) return;

    // Reconstrói arrays de fotos e arquivos
    const newPhotos = this.reorderIndices.map(i => this.selectedPhotos[i]);
    const newFiles = this.reorderIndices.map(i => this.filesToUpload[i]);

    this.selectedPhotos = [...newPhotos];
    this.filesToUpload = [...newFiles];
    
    this.closeReorderModal();
  }

  // ===== IMAGE PREVIEW =====
  public previewImage: string | null = null;

  openPreview(photo: string) {
    this.previewImage = photo;
  }

  closePreview() {
    this.previewImage = null;
  }

  ngOnDestroy() {
    this.nameGuardSub?.unsubscribe();
  }

  /** Termo proibido no título, para a mensagem embaixo do campo. */
  get blockedTerm(): string | null {
    return this.submitProductForm.controls.name.errors?.['blockedWord'] ?? null;
  }

  public async submit () {
     if (this.nameGuard.check(this.submitProductForm.controls.name.value)) {
       this.submitProductForm.controls.name.updateValueAndValidity();
       await this.nameGuard.showBlockedAlert();
       return;
     }
     if (this.submitProductForm.valid) {
      this.isLoading = true;
      try {
        const { variantAttributes, skus } = cleanVariants(this.variantAttributes, this.variantSkus);
        const variantsEnabled = this.hasVariants && variantAttributes.length > 0 && Object.keys(skus).length > 0;
        if (this.hasVariants && !variantsEnabled) {
          throw new Error('Adicione ao menos um atributo com um valor em "Variações", ou desative a opção.');
        }

        if (this.missingCatalogPhoto) {
          throw new Error('Fotos: adicione ao menos uma foto do produto.');
        }
        if (this.missingCatalogOption) {
          throw new Error(`Variações: escolha ao menos uma opção de ${this.missingCatalogOption}.`);
        }

        // Foto do catálogo já é URL pública; só sobem as fotos novas.
        const uploadPromises = this.filesToUpload.map((file, i) =>
          file ? this.servicoFirebase.uploadImage(file) : Promise.resolve(this.selectedPhotos[i]));
        const uploadedUrls = await Promise.all(uploadPromises);
        // Fotos escolhidas para as variações ainda apontam para a prévia local
        // (base64); troca pela URL definitiva no Storage, na mesma ordem de upload.
        const photoUrlByPreview = new Map(this.selectedPhotos.map((preview, i) => [preview, uploadedUrls[i]]));

        this.submitProductForm.patchValue({ photoURL: uploadedUrls });

        const currentUser = this.servicoFirebase.getUser();
        if (!currentUser) throw new Error("Usuário não autenticado");

        const rawVariantImages = variantsEnabled ? cleanVariantImages(variantAttributes, this.variantImages) : {};
        const variantImages: Record<string, string> = {};
        for (const [value, preview] of Object.entries(rawVariantImages)) {
          variantImages[value] = photoUrlByPreview.get(preview) || preview;
        }

        const data = this.submitProductForm.value;
        const novoProduto: Product = {
          ...data,
          name: data.name!,
          price: data.price!,
          condition: data.condition as any,
          stock: variantsEnabled ? totalVariantStock(skus) : data.stock!,
          categoryIds: data.categoryIds!,
          subcategoryIds: data.subcategoryIds || [],
          paymentMethods: data.paymentMethods as any,
          shipping: data.shipping as any,
          weight: data.weight!,
          width: data.width!,
          height: data.height!,
          length: data.length!,
          specs: this.mergedSpecs(data.specs),
          hasVariants: variantsEnabled,
          variantAttributes: variantsEnabled ? variantAttributes : [],
          variantImages,
          skus: variantsEnabled ? skus : {},
          sellerId: currentUser.uid,
          catalogId: this.catalogProduct?.id ?? null,
          gtin: this.catalogProduct?.gtins?.[0] ?? null,
          createdAt: new Date(),
          updatedAt: new Date()
        } as Product;

        const productRef = await this.servicoFirebase.add(novoProduto);
        this.publishedId = productRef.id;
        void this.dispatchProductUploadTrigger(novoProduto, productRef.id, currentUser.displayName || currentUser.email || 'Vendedor');
        await new Promise(r => setTimeout(r, 2000));
        
        this.isLoading = false;
        this.feedbackType = 'success';
        this.feedbackTitle = 'Produto Publicado!';
        this.feedbackMessage = 'Seu anúncio já está disponível para compradores.';
        this.showFeedback = true;
        // The form reset and navigation are moved to onFeedbackClosed()


      } catch (err) {
        console.error('Erro ao publicar produto:', err);
        this.isLoading = false;
        this.feedbackType = 'error';
        this.feedbackTitle = 'Erro ao Publicar';
        this.feedbackMessage = err instanceof Error && (err.message.includes('Variações') || err.message.startsWith('Fotos:'))
          ? err.message
          : 'Verifique sua conexão e tente novamente.';
        this.showFeedback = true;
      }
    }
  }

  private publishedId: string | null = null;

  onFeedbackClosed() {
    this.showFeedback = false;
    if (this.feedbackType === 'success') {
      const id = this.publishedId;
      this.submitProductForm.reset();
      this.selectedPhotos = [];
      this.filesToUpload = [];
      this.hasVariants = false;
      this.variantAttributes = [];
      this.variantSkus = {};
      this.variantImages = {};
      this.published.emit(id ?? '');
      // Mostra o anúncio recém-publicado, do jeito que o comprador vê.
      this.router.navigate(id ? ['/product-details', id] : ['/home']);
    }
  }

  /** Ficha do catálogo + extras do vendedor (sem repetir característica). */
  private mergedSpecs(extras: ProductSpec[] | null | undefined): ProductSpec[] {
    const own = cleanSpecs(extras);
    if (!this.catalogProduct) return own;
    const taken = new Set(this.catalogSpecs.map(spec => normalizeText(spec.label)));
    return [...this.catalogSpecs, ...own.filter(spec => !taken.has(normalizeText(spec.label)))];
  }

  private async dispatchProductUploadTrigger(product: Product, productId: string, sellerName: string): Promise<void> {
    try {
      await this.whatsappService.dispatchTrigger({
        eventType: 'product_uploaded',
        data: {
          produto: product.name,
          produtoId: productId,
          nome: sellerName,
          valor: this.formatCurrency(product.price),
          estoque: product.stock
        }
      });
    } catch (error) {
      console.warn('Falha ao disparar gatilho de upload de produto:', error);
    }
  }

  private formatCurrency(value: number): string {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value || 0);
  }
}
