import { Component, OnInit, inject } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';import { CheckoutStateService } from 'src/app/services/checkout-state.service';
@Component({
  selector: 'app-checkout-payment',
  templateUrl: './checkout-payment.component.html',
  styleUrls: ['./checkout-payment.component.scss'],
  standalone: true,
  imports: [IonicModule, FormsModule, CommonModule]
})
export class CheckoutPaymentComponent implements OnInit {

  // Removendo variaveis locais para usar direto o stateService
  stateService = inject(CheckoutStateService);

  constructor() { }

  ngOnInit() { }
}
