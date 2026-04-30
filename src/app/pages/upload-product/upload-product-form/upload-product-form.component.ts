import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import {  FormControl, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Product } from 'src/app/interfaces/product';
import { FirebaseProducts } from 'src/app/services/firebase-products';
import { FirebaseCategories } from 'src/app/services/firebase-categories';
import { Category, Subcategory } from 'src/app/interfaces/category';
import { NgFor, NgIf, AsyncPipe } from '@angular/common';
import { Observable } from 'rxjs';
import { FeedbackModalComponent } from 'src/app/components/feedback-modal/feedback-modal.component';
import { LoadingSpinnerOverlayComponent } from 'src/app/components/loading-spinner-overlay/loading-spinner-overlay.component';
import { WhatsappInstancesService } from 'src/app/services/whatsapp-instances.service';

@Component({
  selector: 'app-upload-product-form',
  templateUrl: './upload-product-form.component.html',
  styleUrls: ['./upload-product-form.component.scss'],
  imports: [IonicModule, ReactiveFormsModule, FormsModule, NgFor, NgIf, AsyncPipe, FeedbackModalComponent, LoadingSpinnerOverlayComponent ],
  standalone: true  
})
export class UploadProductFormComponent  implements OnInit {

  public isFormValid : boolean = false;
  public selectedPhotos: string[] = []; 
  private filesToUpload: File[] = [];
  public categories$!: Observable<Category[]>;
  public availableSubcategories: Subcategory[] = [];
  private allCategories: Category[] = [];
  
  public shippingOptions: ('Frete Grátis' | 'A combinar' | 'Entrega Expressa')[] = ['Frete Grátis', 'A combinar', 'Entrega Expressa'];
  public availablePaymentMethods: ('PIX' | 'CARTÃO' | 'DINHEIRO')[] = ['PIX', 'CARTÃO', 'DINHEIRO'];

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
    this.categories$ = this.servicoCategorias.getAll();
    this.categories$.subscribe(cats => this.allCategories = cats);

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
    const files = event.target.files;
    if (files) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        this.filesToUpload.push(file);

        const reader = new FileReader();
        reader.onload = (e: any) => {
          this.selectedPhotos.push(e.target.result);
        };
        reader.readAsDataURL(file);
      }
    }
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

  public async submit () {
     if (this.submitProductForm.valid) {
      this.isLoading = true;
      try {
        const uploadPromises = this.filesToUpload.map(file => this.servicoFirebase.uploadImage(file));
        const uploadedUrls = await Promise.all(uploadPromises);

        this.submitProductForm.patchValue({ photoURL: uploadedUrls });

        const currentUser = this.servicoFirebase.getUser();
        if (!currentUser) throw new Error("Usuário não autenticado");

        const data = this.submitProductForm.value;
        const novoProduto: Product = {
          ...data,
          name: data.name!,
          price: data.price!,
          condition: data.condition as any,
          stock: data.stock!,
          categoryIds: data.categoryIds!,
          subcategoryIds: data.subcategoryIds || [],
          paymentMethods: data.paymentMethods as any,
          shipping: data.shipping as any,
          weight: data.weight!,
          width: data.width!,
          height: data.height!,
          length: data.length!,
          sellerId: currentUser.uid,
          createdAt: new Date(),
          updatedAt: new Date()
        } as Product;

        const productRef = await this.servicoFirebase.add(novoProduto);
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
        this.feedbackMessage = 'Verifique sua conexão e tente novamente.';
        this.showFeedback = true;
      }
    }
  }

  onFeedbackClosed() {
    this.showFeedback = false;
    if (this.feedbackType === 'success') {
      this.submitProductForm.reset();
      this.selectedPhotos = [];
      this.filesToUpload = [];
      this.router.navigate(['/home']);
    }
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
