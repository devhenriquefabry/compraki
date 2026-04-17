import { Component, inject, OnInit } from '@angular/core';
import { Router } from '@angular/router';

import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';

@Component({
  selector: 'app-payment-success',
  templateUrl: './payment-success.page.html',
  styleUrls: ['./payment-success.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class PaymentSuccessPage implements OnInit {

  private router = inject(Router);

  constructor() { }

  ngOnInit() {
    // Esperar 2 segundos e redirecionar para Meus Pedidos
    setTimeout(() => {
      this.router.navigate(['/my-orders'], { replaceUrl: true });
    }, 2500); // 2.5s para dar tempo da animação brilhar
  }

}
