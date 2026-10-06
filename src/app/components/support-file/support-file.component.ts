import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';

import { formatFileSize } from '../../core/support-config';
import { SupportAttachment } from '../../interfaces/support';
import { SupportService } from '../../services/support.service';
import { VnIconComponent } from '../vn-icon/vn-icon.component';

/**
 * Anexo de um atendimento: foto (miniatura) ou PDF (cartão). O link de
 * download vem do Storage sob demanda (só a pessoa dona e a equipe leem).
 */
@Component({
  selector: 'vn-support-file',
  standalone: true,
  imports: [VnIconComponent],
  template: `
    @if (url(); as href) {
      @if (isImage()) {
        <a class="sf sf-img" [href]="href" target="_blank" rel="noopener" [attr.aria-label]="'Abrir foto ' + file().name">
          <img [src]="href" [alt]="file().name" loading="lazy" />
        </a>
      } @else {
        <a class="sf sf-doc" [href]="href" target="_blank" rel="noopener">
          <vn-icon name="doc" />
          <span><strong>{{ file().name }}</strong><small>PDF · {{ size() }}</small></span>
        </a>
      }
    } @else if (failed()) {
      <span class="sf sf-doc is-off"><vn-icon name="close" /><span><strong>Anexo indisponível</strong></span></span>
    } @else {
      <span class="sf sf-doc is-loading" aria-busy="true"><span class="sf-sk"></span></span>
    }
  `,
  styleUrls: ['./support-file.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SupportFileComponent {
  private readonly support = inject(SupportService);

  readonly file = input.required<SupportAttachment>();

  readonly url = signal<string | null>(null);
  readonly failed = signal(false);
  readonly isImage = computed(() => this.file().contentType.startsWith('image/'));
  readonly size = computed(() => formatFileSize(this.file().size));

  constructor() {
    effect(() => {
      const path = this.file().path;
      this.url.set(null);
      this.failed.set(false);
      this.support.attachmentUrl(path)
        .then(url => this.url.set(url))
        .catch(() => this.failed.set(true));
    });
  }
}
