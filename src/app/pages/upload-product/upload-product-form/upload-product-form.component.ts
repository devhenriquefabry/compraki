import { Component, OnInit } from '@angular/core';
import {  FormControl, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Product } from 'src/app/interfaces/product';
import { FirebaseProducts } from 'src/app/services/firebase-products';
import { NgFor, NgIf } from '@angular/common';

@Component({
  selector: 'app-upload-product-form',
  templateUrl: './upload-product-form.component.html',
  styleUrls: ['./upload-product-form.component.scss'],
  imports: [IonicModule, ReactiveFormsModule, FormsModule, NgFor, NgIf ],
  standalone: true  
})
export class UploadProductFormComponent  implements OnInit {

  public isFormValid : boolean = false;
  public selectedPhotos: string[] = []; // Para prévia (base64)
  private filesToUpload: File[] = [];   // Arquivos reais para upload
  
  submitProductForm = new FormGroup({
    id: new FormControl(''),
    photoURL: new FormControl<string[]>([]),
    name: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    condition: new FormControl('novo', [Validators.required]),
    price: new FormControl<number | null>(null, [Validators.required]),
    stock: new FormControl<number>(1, [Validators.required]),
    acceptOffers: new FormControl(true),
    description: new FormControl('', [Validators.required]),
  });

  constructor(private servicoFirebase : FirebaseProducts) { }

  ngOnInit() {
    this.submitProductForm.statusChanges.subscribe(status => {
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

  public async submit () {
     if (this.submitProductForm.valid) {
      try {
        console.log('Iniciando upload de ' + this.filesToUpload.length + ' imagens...');
        
        const uploadPromises = this.filesToUpload.map(file => this.servicoFirebase.uploadImage(file));
        const uploadedUrls = await Promise.all(uploadPromises);

        this.submitProductForm.patchValue({ photoURL: uploadedUrls });

        const novoProduto = this.submitProductForm.value as Product;

        await this.servicoFirebase.add(novoProduto);
        
        alert('Produto publicado com sucesso!');
        this.submitProductForm.reset(); 
        this.selectedPhotos = [];
        this.filesToUpload = [];

      } catch (err) {
        console.error('Erro ao publicar produto:', err);
        alert('Erro ao publicar produto. Verifique sua conexão.');
      }
    }
  }

  async enviarComFoto(files: FileList | null) {
  if (this.submitProductForm.valid && files && files.length > 0) {
    const file = files[0]; 

    try {
      const downloadURL = await this.servicoFirebase.uploadImage(file);
      const dados = this.submitProductForm.value;
      const novoProduto: Product = {
        ...dados,
        photoURL: [downloadURL]
      } as Product;

      await this.servicoFirebase.add(novoProduto);
      
      this.submitProductForm.reset();
      this.selectedPhotos = [];
      alert('Produto cadastrado com sucesso!');
      
    } catch (error) {
      console.error("Erro ao processar:", error);
      alert('Erro ao enviar imagem ou dados.');
    }
  } else if (!files || files.length === 0) {
    alert('Por favor, selecione uma imagem.');
  }
}
}
