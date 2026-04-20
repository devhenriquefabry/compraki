import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';

@Component({
  selector: 'app-dev-header',
  templateUrl: './dev-header.component.html',
  styleUrls: ['./dev-header.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class DevHeaderComponent {
  @Input() titlePage: string = 'Painel do Desenvolvedor';
  @Input() showBackButton: boolean = false;
  @Input() defaultBackHref: string = '/home';
  @Input() showMenuButton: boolean = true;
}
