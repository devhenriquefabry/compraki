import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonicModule, IonModal } from '@ionic/angular';
import { Observable } from 'rxjs';
import { Product } from 'src/app/interfaces/product';

@Component({
  selector: 'app-product-selector',
  templateUrl: './product-selector.component.html',
  styleUrls: ['./product-selector.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterLink]
})
export class ProductSelectorComponent {
  @Input() allProducts$!: Observable<Product[]>;
  @Output() productSelected = new EventEmitter<string>();
  @ViewChild(IonModal) modal!: IonModal;

  public selectedProduct: Product | null = null;
  public readonly placeholder = 'https://placehold.co/200x200/f0f2f5/a0aec0?text=Sem+Foto';

  handleImageError(event: any) {
    event.target.src = this.placeholder;
  }

  selectAndClose(product: Product) {
    this.selectedProduct = product;
    this.productSelected.emit(product.id);
    this.modal.dismiss();
  }
}
