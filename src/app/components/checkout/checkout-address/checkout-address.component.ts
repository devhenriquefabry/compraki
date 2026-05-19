import { Component, OnInit, inject, Input } from '@angular/core';
import { IonicModule, NavController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { AddressService, Address } from 'src/app/services/address.service';
import { CheckoutStateService } from 'src/app/services/checkout-state.service';

@Component({
  selector: 'app-checkout-address',
  templateUrl: './checkout-address.component.html',
  styleUrls: ['./checkout-address.component.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule]
})
export class CheckoutAddressComponent implements OnInit {
  @Input() readOnly: boolean = false;


  private addressService = inject(AddressService);
  private stateService = inject(CheckoutStateService);
  private navCtrl = inject(NavController);

  selectedAddress: Address | null = null;

  constructor() { }

  ngOnInit() {
    this.addressService.addresses$.subscribe(addresses => {
      if (addresses && addresses.length > 0) {
        // Encontra o endereço padrão ou pega o primeiro
        this.selectedAddress = addresses.find(a => a.isDefault) || addresses[0];
        
        // Sincroniza com o estado do checkout para a API usar o CEP correto
        if (this.selectedAddress) {
          this.stateService.addressData = {
            postalCode: this.selectedAddress.zipCode,
            addressNumber: this.selectedAddress.number
          };
        }
      } else {
        this.selectedAddress = null;
      }
    });
  }

  alterarEndereco() {
    // Redireciona o usuário para a página de endereços onde ele pode gerenciar/adicionar
    this.navCtrl.navigateForward('/address');
  }

}
