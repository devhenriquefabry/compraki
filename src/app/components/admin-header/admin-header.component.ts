import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';

@Component({
  selector: 'app-admin-header',
  templateUrl: './admin-header.component.html',
  styleUrls: ['./admin-header.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class AdminHeaderComponent {
  @Input() titlePage: string = 'Painel Admin';
  @Input() showBackButton: boolean = false;
  @Input() defaultBackHref: string = '/home';
  @Input() showMenuButton: boolean = true;
}
