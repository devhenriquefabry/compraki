import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonicModule } from '@ionic/angular';
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

  onProductSelect(event: any) {
    this.productSelected.emit(event.detail.value);
  }
}
