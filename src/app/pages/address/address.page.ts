import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController, AlertController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { 
  home, briefcase, pencil, trash, add, 
  locationOutline, homeOutline, briefcaseOutline,
  closeOutline, saveOutline
} from 'ionicons/icons';
import { Subscription } from 'rxjs';
import { MiniHeaderComponent } from '../../components/mini-header/mini-header.component';
import { AddressModalComponent } from '../../components/address-modal/address-modal.component';
import { AddressService, Address } from '../../services/address.service';

@Component({
  selector: 'app-address',
  templateUrl: './address.page.html',
  styleUrls: ['./address.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    MiniHeaderComponent,
    AddressModalComponent
  ]
})
export class AddressPage implements OnInit, OnDestroy {
  addresses: Address[] = [];
  private sub!: Subscription;

  private modalCtrl = inject(ModalController);
  private alertCtrl = inject(AlertController);
  private addressService = inject(AddressService);

  constructor() { 
    addIcons({ 
      home, briefcase, pencil, trash, add, 
      locationOutline, homeOutline, briefcaseOutline,
      closeOutline, saveOutline
    });
  }

  ngOnInit() {
    this.sub = this.addressService.addresses$.subscribe(items => {
      this.addresses = items;
    });
  }

  ngOnDestroy() {
    if (this.sub) this.sub.unsubscribe();
  }

  setDefault(addressId: string) {
    this.addressService.setDefault(addressId);
  }

  async deleteAddress(addressId: string) {
    const alert = await this.alertCtrl.create({
      header: 'Confirmar Exclusão',
      message: 'Tem certeza que deseja excluir este endereço? Esta ação não pode ser desfeita.',
      buttons: [
        {
          text: 'Cancelar',
          role: 'cancel',
          cssClass: 'secondary'
        },
        {
          text: 'Excluir',
          role: 'destructive',
          handler: () => {
            this.addressService.deleteAddress(addressId);
          }
        }
      ]
    });

    await alert.present();
  }

  async editAddress(address: Address) {
    const modal = await this.modalCtrl.create({
      component: AddressModalComponent,
      componentProps: {
        address: { ...address },
        isEdit: true
      },
      breakpoints: [0, 0.8, 1],
      initialBreakpoint: 0.8
    });

    await modal.present();

    const { data } = await modal.onWillDismiss();
    if (data) {
      this.addressService.updateAddress(data);
    }
  }

  async addNewAddress() {
    const modal = await this.modalCtrl.create({
      component: AddressModalComponent,
      componentProps: {
        isEdit: false
      },
      breakpoints: [0, 0.8, 1],
      initialBreakpoint: 0.8
    });

    await modal.present();

    const { data } = await modal.onWillDismiss();
    if (data) {
      // Gera um ID simples para o mock
      data.id = Math.random().toString(36).substr(2, 9);
      this.addressService.addAddress(data);
    }
  }
}
