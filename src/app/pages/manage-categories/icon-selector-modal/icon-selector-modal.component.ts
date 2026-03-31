import { Component, OnInit } from '@angular/core';
import { ModalController, IonicModule } from '@ionic/angular';
import { CommonModule, NgFor, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-icon-selector-modal',
  templateUrl: './icon-selector-modal.component.html',
  styleUrls: ['./icon-selector-modal.component.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, NgFor, NgIf]
})
export class IconSelectorModalComponent implements OnInit {
  public icons: string[] = [
    'laptop-outline', 'shirt-outline', 'bed-outline', 'basketball-outline', 
    'car-outline', 'gift-outline', 'home-outline', 'game-controller-outline', 
    'nutrition-outline', 'paw-outline', 'build-outline', 'fast-food-outline', 
    'musical-notes-outline', 'camera-outline', 'phone-portrait-outline', 
    'watch-outline', 'glasses-outline', 'briefcase-outline', 'wallet-outline', 
    'cart-outline', 'storefront-outline', 'pricetags-outline', 'flower-outline', 
    'diamond-outline', 'headset-outline', 'brush-outline', 'color-palette-outline',
    'fitness-outline', 'medical-outline', 'flask-outline', 'book-outline',
    'school-outline', 'airplane-outline', 'bicycle-outline', 'boat-outline',
    'bus-outline', 'pizza-outline', 'wine-outline', 'beer-outline', 'restaurant-outline'
  ];
  
  public filteredIcons: string[] = [];
  public searchTerm: string = '';

  constructor(private modalCtrl: ModalController) {}

  ngOnInit() {
    this.filteredIcons = [...this.icons];
  }

  filterIcons() {
    const term = this.searchTerm.toLowerCase();
    this.filteredIcons = this.icons.filter(icon => icon.toLowerCase().includes(term));
  }

  selectIcon(icon: string) {
    this.modalCtrl.dismiss(icon);
  }

  close() {
    this.modalCtrl.dismiss();
  }
}
