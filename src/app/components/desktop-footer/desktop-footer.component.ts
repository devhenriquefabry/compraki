import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { COMPANY } from '../../core/legal-info';
import { SocialLinksComponent } from '../social-links/social-links.component';

/** Rodapé do site de desktop. Só links para telas que existem no app. */
@Component({
  selector: 'app-desktop-footer',
  standalone: true,
  imports: [RouterLink, SocialLinksComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './desktop-footer.component.html',
  styleUrls: ['./desktop-footer.component.scss'],
})
export class DesktopFooterComponent {
  readonly year = new Date().getFullYear();
  /** Razão social, CNPJ e endereço: o Decreto 7.962/2013 pede em local visível. */
  readonly company = COMPANY;
}
