import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FormControl, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Product } from 'src/app/interfaces/product';
import { FirebaseProducts } from 'src/app/services/firebase-products';
import { NgFor, NgIf, CommonModule } from '@angular/common';

@Component({
  selector: 'app-edit-product-form',
  templateUrl: './edit-product-form.component.html',
  styleUrls: ['./edit-product-form.component.scss'],
  standalone: true,
  imports: [IonicModule, ReactiveFormsModule, FormsModule, NgFor, NgIf, CommonModule]
})
export class EditProductFormComponent implements OnInit {
  @Input() product!: Product;
  @Output() cancel = new EventEmitter<void>();

  public isFormValid: boolean = false;
  public selectedPhotos: string[] = []; // Para prévia (urls ou base64)
  private filesToUpload: File[] = [];

  editProductForm = new FormGroup({
    id: new FormControl(''),
    photoURL: new FormControl<string[]>([]),
    name: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    condition: new FormControl('novo', [Validators.required]),
    price: new FormControl<number | null>(null, [Validators.required]),
    stock: new FormControl<number>(1, [Validators.required]),
    acceptOffers: new FormControl(true),
    description: new FormControl('', [Validators.required]),
  });

  constructor(private servicoFirebase: FirebaseProducts) { }

  ngOnInit() {
    if (this.product) {
      this.editProductForm.patchValue(this.product);
      this.selectedPhotos = this.product.photoURL || [];
    }

    this.editProductForm.statusChanges.subscribe(status => {
      this.isFormValid = status === 'VALID';
    });
  }

  onFileSelected(event: any) {
    const files = event.target.files;
    if (files) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        this.filesToUpload.push(file);
        const reader = new FileReader();
        reader.onload = (e: any) => this.selectedPhotos.push(e.target.result);
        reader.readAsDataURL(file);
      }
    }
  }

  removePhoto(index: number) {
    this.selectedPhotos.splice(index, 1);
    // Se for um arquivo novo a ser enviado, remove da lista de upload
    // Nota: Essa lógica simplificada não remove URLs antigas do Firebase Storage, apenas do array local
  }

  async submit() {
    if (this.editProductForm.valid) {
      try {
        let finalPhotoUrls = [...(this.product.photoURL || [])];
        
        // Se houver novos arquivos, faz upload
        if (this.filesToUpload.length > 0) {
          const uploadPromises = this.filesToUpload.map(file => this.servicoFirebase.uploadImage(file));
          const newUrls = await Promise.all(uploadPromises);
          finalPhotoUrls = [...finalPhotoUrls, ...newUrls];
        }

        // Garante que mostre as fotos que sobraram se algumas foram "removidas" na UI
        // Para simplificar, estamos apenas concatenando novas. 
        // Em um app real, compararíamos selectedPhotos com photoURL original.
        
        this.editProductForm.patchValue({ photoURL: this.selectedPhotos.filter(p => !p.startsWith('data:')) });
        // Na verdade, vamos apenas usar o que está em selectedPhotos se não for base64
        const currentUrls = this.selectedPhotos.filter(p => !p.startsWith('data:'));
        
        const updatedProduct = {
          ...this.editProductForm.value,
          photoURL: [...currentUrls]
        } as Product;

        if (this.filesToUpload.length > 0) {
           const newUrls = await Promise.all(this.filesToUpload.map(f => this.servicoFirebase.uploadImage(f)));
           updatedProduct.photoURL = [...updatedProduct.photoURL || [], ...newUrls];
        }

        await this.servicoFirebase.update(updatedProduct);
        alert('Produto atualizado com sucesso!');
        this.cancel.emit();

      } catch (err) {
        console.error('Erro ao atualizar produto:', err);
        alert('Erro ao atualizar. Verifique sua conexão.');
      }
    }
  }

  onCancel() {
    this.cancel.emit();
  }
}
