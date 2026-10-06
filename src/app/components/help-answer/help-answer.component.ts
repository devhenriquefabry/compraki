import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';

import { HelpHit, HelpLink, segments, findArticle } from '../../core/help-content';
import { VnIconComponent } from '../vn-icon/vn-icon.component';

/**
 * Uma resposta da Central de ajuda, para mostrar fora de `/help` (hoje, na folha
 * "Isso resolve?" do formulário de atendimento). O conteúdo é o mesmo de
 * `core/help-content.ts`; só a apresentação é enxuta, sem acordeão.
 */
@Component({
  selector: 'vn-help-answer',
  standalone: true,
  imports: [RouterLink, VnIconComponent],
  templateUrl: './help-answer.component.html',
  styleUrls: ['./help-answer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HelpAnswerComponent {
  readonly hit = input.required<HelpHit>();
  /** O usuário tocou num link que sai desta tela: quem abriu a folha fecha ela. */
  readonly navigated = output<void>();

  readonly parts = segments;

  /** Link para outra pergunta vira link para a Central, já aberta nela. */
  readonly links = computed(() => (this.hit().article.links ?? []).map(link => ({
    label: link.label,
    route: link.article ? '/help' : link.route ?? '/help',
    query: link.article
      ? { assunto: findArticle(link.article)?.topic.id ?? null, pergunta: link.article }
      : link.query ?? null,
  })));

  trackLink(_: number, link: Pick<HelpLink, 'label'>): string {
    return link.label;
  }
}
