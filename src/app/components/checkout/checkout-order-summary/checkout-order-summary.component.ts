import { Component, Input, OnInit } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { Product } from 'src/app/interfaces/product';

@Component({
  selector: 'app-checkout-order-summary',
  templateUrl: './checkout-order-summary.component.html',
  styleUrls: ['./checkout-order-summary.component.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule]
})
export class CheckoutOrderSummaryComponent implements OnInit {

  @Input() produto: Product | null = null;

  constructor() { }

  ngOnInit() {}

}
