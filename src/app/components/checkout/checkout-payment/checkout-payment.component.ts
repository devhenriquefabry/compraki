import { Component, OnInit } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-checkout-payment',
  templateUrl: './checkout-payment.component.html',
  styleUrls: ['./checkout-payment.component.scss'],
  standalone: true,
  imports: [IonicModule, FormsModule, CommonModule]
})
export class CheckoutPaymentComponent implements OnInit {

  paymentMethod: string = 'credit';

  constructor() { }

  ngOnInit() { }

}
