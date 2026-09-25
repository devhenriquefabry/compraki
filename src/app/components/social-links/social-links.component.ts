import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { logoFacebook, logoInstagram, logoTiktok, logoWhatsapp, logoX, logoYoutube } from 'ionicons/icons';

import { SOCIAL_NETWORKS } from '../../interfaces/app-config';
import { AppConfigService } from '../../services/app-config.service';

/**
 * Ícones das redes sociais da Vineon, com os links que o admin cadastra na aba
 * Ajustes do painel. Rede sem link não aparece; sem nenhum link, o componente
 * não desenha nada (nem o título).
 *
 * `tone="dark"` para fundo marinho (rodapé do site), `light` para fundo claro.
 */
@Component({
  selector: 'app-social-links',
  standalone: true,
  imports: [IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (links().length) {
      <div class="sl" [attr.data-tone]="tone()">
        @if (heading()) { <p class="sl-heading">{{ heading() }}</p> }
        <ul class="sl-list">
          @for (link of links(); track link.id) {
            <li>
              <a class="sl-link" [href]="link.url" target="_blank" rel="noopener noreferrer" [attr.aria-label]="'Vineon no ' + link.label" [title]="link.label">
                <ion-icon [name]="link.icon" aria-hidden="true"></ion-icon>
              </a>
            </li>
          }
        </ul>
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .sl-heading {
      margin: 0 0 8px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      opacity: 0.75;
    }
    .sl-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .sl-link {
      display: grid;
      place-items: center;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      font-size: 18px;
      text-decoration: none;
      transition: background-color 0.15s ease, color 0.15s ease;
    }
    [data-tone='dark'] .sl-link { background: rgba(255, 255, 255, 0.08); color: rgba(255, 255, 255, 0.85); }
    [data-tone='dark'] .sl-link:hover { background: var(--vn-neon, #D8F51F); color: var(--vn-navy-900, #0B1623); }
    [data-tone='light'] .sl-link { background: #eef1f5; color: var(--vn-navy-800, #0B1623); }
    [data-tone='light'] .sl-link:hover { background: var(--vn-navy-800, #0B1623); color: #fff; }
    .sl-link:focus-visible { outline: 2px solid var(--vn-neon-ink, #0B1623); outline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) { .sl-link { transition: none; } }
  `],
})
export class SocialLinksComponent {
  readonly tone = input<'dark' | 'light'>('light');
  readonly heading = input<string>('');

  private readonly appConfig = inject(AppConfigService);

  readonly links = computed(() => {
    const configured = this.appConfig.config().socialLinks;
    return SOCIAL_NETWORKS
      .filter(n => !!configured[n.id])
      .map(n => ({ ...n, url: configured[n.id] as string }));
  });

  constructor() {
    addIcons({ logoFacebook, logoInstagram, logoTiktok, logoWhatsapp, logoX, logoYoutube });
  }
}
