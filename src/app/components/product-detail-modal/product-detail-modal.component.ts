import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule, DecimalPipe, DatePipe } from '@angular/common';
import { IonicModule } from '@ionic/angular';

@Component({
  selector: 'app-product-detail-modal',
  templateUrl: './product-detail-modal.component.html',
  styleUrls: ['./product-detail-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, DecimalPipe, DatePipe]
})
export class ProductDetailModalComponent implements OnChanges {

  @Input() product: any = null;
  @Input() sellerName: string = '...';
  @Input() isCurrentUser: boolean = false;

  @Output() closed = new EventEmitter<void>();
  @Output() chatRequested = new EventEmitter<void>();

  activeImageIndex: number = 0;
  currentTab: string = 'details';

  setTab(tab: string) {
    this.currentTab = tab;
  }

  get images(): string[] {
    return this.product?.photoURL?.length > 0
      ? this.product.photoURL
      : ['assets/imagens/app-logo.png'];
  }

  get conditionLabel(): string {
    const map: { [key: string]: string } = {
      'novo': 'Novo',
      'usado-como-novo': 'Usado - Como Novo',
      'usado-bom': 'Usado - Bom Estado',
      'usado-aceitavel': 'Usado - Aceitável'
    };
    return map[this.product?.condition] || 'Não informado';
  }

  get conditionClass(): string {
    if (this.product?.condition === 'novo') return 'condition-new';
    return 'condition-used';
  }

  get stockStatus(): string {
    const stock = this.product?.stock || 0;
    if (stock <= 0) return 'Esgotado';
    if (stock <= 5) return 'Últimas unidades';
    return 'Em estoque';
  }

  get stockClass(): string {
    const stock = this.product?.stock || 0;
    if (stock <= 0) return 'stock-out';
    if (stock <= 5) return 'stock-low';
    return 'stock-ok';
  }

  get hasDiscount(): boolean {
    return this.product?.priceDiscounted != null && this.product.priceDiscounted > 0 && this.product.priceDiscounted < this.product.price;
  }

  get discountPercent(): number {
    if (!this.hasDiscount) return 0;
    return Math.round(((this.product.price - this.product.priceDiscounted) / this.product.price) * 100);
  }

  get paymentMethodsFormatted(): string[] {
    return this.product?.paymentMethods || [];
  }

  get paymentIcon(): { [key: string]: string } {
    return {
      'PIX': 'grid-outline',
      'CARTÃO': 'card-outline',
      'DINHEIRO': 'cash-outline'
    };
  }

  get totalRevenue(): number {
    return (this.product?.soldCount || 0) * (this.product?.price || 0);
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['product']) {
      this.activeImageIndex = 0;
    }
  }

  selectImage(index: number) {
    this.activeImageIndex = index;
  }

  prevImage() {
    if (this.activeImageIndex > 0) {
      this.activeImageIndex--;
    } else {
      this.activeImageIndex = this.images.length - 1;
    }
  }

  nextImage() {
    if (this.activeImageIndex < this.images.length - 1) {
      this.activeImageIndex++;
    } else {
      this.activeImageIndex = 0;
    }
  }

  close() {
    this.closed.emit();
  }

  onChatClick() {
    this.chatRequested.emit();
  }

  onBackdropClick(event: MouseEvent) {
    if ((event.target as HTMLElement).classList.contains('modal-backdrop')) {
      this.close();
    }
  }

  copyId() {
    if (this.product?.id) {
      navigator.clipboard.writeText(this.product.id);
    }
  }
}
