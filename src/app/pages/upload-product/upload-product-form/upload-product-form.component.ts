import { Component, OnInit } from '@angular/core';
import {  FormControl, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Product } from 'src/app/interfaces/product';
import { FirebaseProducts } from 'src/app/services/firebase-products';

@Component({
  selector: 'app-upload-product-form',
  templateUrl: './upload-product-form.component.html',
  styleUrls: ['./upload-product-form.component.scss'],
  imports: [IonicModule, ReactiveFormsModule, FormsModule ],
  standalone: true  
})
export class UploadProductFormComponent  implements OnInit {

  public isFormValid : boolean = false


  produtos = [
  {
    "id": 1,
    "name": "Eletrônicos",
    "icon": "hardware-chip-outline",
    "subcategories": [
      {
        "id": 101,
        "name": "Computadores",
        "types": ["Notebooks", "Desktops", "Monitores", "Peças e Componentes"]
      },
      {
        "id": 102,
        "name": "Celulares e Telefonia",
        "types": ["Smartphones", "Smartwatches", "Acessórios"]
      },
      {
        "id": 103,
        "name": "Áudio e Vídeo",
        "types": ["Fones de Ouvido", "Caixas de Som", "Televisores"]
      }
    ]
  },
  {
    "id": 2,
    "name": "Moda e Acessórios",
    "icon": "shirt-outline",
    "subcategories": [
      {
        "id": 201,
        "name": "Roupas",
        "types": ["Masculino", "Feminino", "Infantil"]
      },
      {
        "id": 202,
        "name": "Calçados",
        "types": ["Tênis", "Sapatos", "Sandálias"]
      }
    ]
  },
  {
    "id": 3,
    "name": "Casa e Jardim",
    "icon": "home-outline",
    "subcategories": [
      {
        "id": 301,
        "name": "Móveis",
        "types": ["Camas", "Sofás", "Mesas e Cadeiras"]
      },
      {
        "id": 302,
        "name": "Eletrodomésticos",
        "types": ["Geladeiras", "Fogões", "Máquinas de Lavar"]
      }
    ]
  }
]

  control : any = '';
    
  submitProductForm = new FormGroup({
    id: new FormControl('1123'),
    photoURL: new FormControl<string[]>([]), // Inicializado como array vazio
    shipping: new FormControl<'Frete Grátis' | 'A combinar'>('Frete Grátis'),
    rating: new FormControl(0),
    soldCount: new FormControl<number | null>(null),
    name: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    price: new FormControl<number | null>(null, [Validators.required]),
    priceDiscounted: new FormControl<number | null>(null, [Validators.required]),
    isUsed: new FormControl<boolean | null>(null, [Validators.required]),
    paymentMethod: new FormControl<'PIX' | 'CARTÃO' | null>(null, [Validators.required]),
    description: new FormControl('', [Validators.required]),
    terms: new FormControl(false, [Validators.requiredTrue]) // Validators.requiredTrue para checkbox
  });
  constructor(private servicoFirebase : FirebaseProducts) { }

  ngOnInit() {
    this.submitProductForm.valueChanges.subscribe((dadosEmSi)=>{
      if(this.submitProductForm.valid && this.submitProductForm.value['terms'] === true){
      this.isFormValid = true
      } else{
      this.isFormValid = false

      }
    })
  }
  public submit () {
     if (this.submitProductForm.valid) {
    // 1. Extraímos os valores do formulário
    const { terms, ...dadosProduto } = this.submitProductForm.value;

    // 2. Fazemos o "cast" para Product (garantindo que os dados batem com a interface)
    const novoProduto = dadosProduto as Product;

    // 3. Chamamos o serviço
    this.servicoFirebase.add(novoProduto)
      .then(() => {
        console.log('Produto salvo com sucesso!');
        this.submitProductForm.reset(); // Limpa o formulário após o sucesso
      })
      .catch(err => console.error('Erro ao salvar:', err));
  }
  }










  async enviarComFoto(files: FileList | null) {
  if (this.submitProductForm.valid && files && files.length > 0) {
    const file = files[0]; // Pega a primeira imagem selecionada

    try {
      // 1. Faz o upload para o Storage e pega a URL
      const downloadURL = await this.servicoFirebase.uploadImage(file);

      // 2. Extrai dados do formulário e injeta a URL
      const { terms, ...dados } = this.submitProductForm.value;
      const novoProduto: Product = {
        ...dados,
        photoURL: [downloadURL] // Salva no array como definido na sua interface
      } as Product;

      // 3. Salva no Firestore
      await this.servicoFirebase.add(novoProduto);
      
      this.submitProductForm.reset();
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
