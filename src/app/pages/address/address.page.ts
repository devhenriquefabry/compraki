import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { AlertController, IonicModule, ModalController, NavController, ToastController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  add, arrowBack, briefcaseOutline, createOutline, homeOutline, locationOutline, location, star, trashOutline,
} from 'ionicons/icons';
import { AddressModalComponent } from '../../components/address-modal/address-modal.component';
import { Address, AddressService } from '../../services/address.service';

@Component({
  selector: 'app-address',
  templateUrl: './address.page.html',
  styleUrls: ['./address.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule],
})
export class AddressPage {
  private readonly modalCtrl = inject(ModalController);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);
  private readonly navCtrl = inject(NavController);
  private readonly addressService = inject(AddressService);

  readonly addresses = toSignal(this.addressService.addresses$, { initialValue: [] as Address[] });
  readonly loaded = toSignal(this.addressService.loaded$, { initialValue: false });

  readonly primary = computed(() => this.addresses().find(a => a.isDefault) ?? this.addresses()[0] ?? null);
  readonly others = computed(() => this.addresses().filter(a => a !== this.primary()));

  constructor() {
    addIcons({ add, arrowBack, briefcaseOutline, createOutline, homeOutline, locationOutline, location, star, trashOutline });
  }

  icon(a: Address): string {
    if (a.type === 'Casa') return 'home-outline';
    if (a.type === 'Trabalho') return 'briefcase-outline';
    return 'location-outline';
  }

  line1(a: Address): string {
    return `${a.street}, ${a.number}${a.complement ? ' · ' + a.complement : ''}`;
  }

  line2(a: Address): string {
    return [a.neighborhood, `${a.city}/${a.state}`].filter(Boolean).join(' · ');
  }

  goBack() {
    if (window.history.length > 1) this.navCtrl.back();
    else this.navCtrl.navigateRoot('/tabs/my-account');
  }

  async addNewAddress() {
    await this.openForm(null);
  }

  async editAddress(address: Address) {
    await this.openForm(address);
  }

  private async openForm(address: Address | null) {
    const modal = await this.modalCtrl.create({
      component: AddressModalComponent,
      componentProps: {
        address: address ? { ...address } : null,
        isEdit: !!address,
        isFirst: !address && this.addresses().length === 0,
      },
      cssClass: 'vn-address-modal',
    });
    await modal.present();

    const { data, role } = await modal.onWillDismiss<Address>();
    if (role !== 'save' || !data) return;
    try {
      await this.addressService.saveAddress(data);
      this.toast(address ? 'Endereço atualizado.' : 'Endereço salvo.', 'success');
    } catch (err) {
      console.error('Falha ao salvar endereço', err);
      this.toast('Não foi possível salvar o endereço. Tente de novo.', 'danger');
    }
  }

  async setDefault(address: Address) {
    try {
      await this.addressService.setDefault(address.id);
      this.toast(`"${address.type}" agora é seu endereço padrão.`, 'dark');
    } catch (err) {
      console.error(err);
      this.toast('Não foi possível trocar o endereço padrão.', 'danger');
    }
  }

  async deleteAddress(address: Address) {
    const alert = await this.alertCtrl.create({
      header: 'Excluir endereço?',
      message: `${this.line1(address)} será removido da sua conta.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Excluir', role: 'destructive' },
      ],
    });
    await alert.present();
    if ((await alert.onDidDismiss()).role !== 'destructive') return;

    try {
      await this.addressService.deleteAddress(address.id);
      this.toast('Endereço excluído.', 'dark');
    } catch (err) {
      console.error(err);
      this.toast('Não foi possível excluir o endereço.', 'danger');
    }
  }

  private async toast(message: string, color: string) {
    const t = await this.toastCtrl.create({ message, duration: 2600, color, position: 'bottom' });
    await t.present();
  }
}
