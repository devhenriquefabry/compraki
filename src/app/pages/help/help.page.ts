import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonContent, IonicModule, NavController } from '@ionic/angular';

import { VnIconComponent } from '../../components/vn-icon/vn-icon.component';
import {
  HELP_TOPICS,
  HelpProfile,
  HelpSegment,
  findArticle,
  findTopic,
  popularFor,
  searchHelp,
  segments,
  topicsFor,
} from '../../core/help-content';
import { COMPANY } from '../../core/legal-info';
import type { VnIconName } from '../../core/vn-icons';

interface Shortcut {
  label: string;
  icon: VnIconName;
  route: string;
  query?: Record<string, string>;
}

/** Atalhos de quem está comprando e de quem está vendendo: levam direto à tela certa. */
const SHORTCUTS: Record<HelpProfile, Shortcut[]> = {
  buy: [
    { label: 'Minhas compras', icon: 'box', route: '/my-orders' },
    { label: 'Rastrear pedido', icon: 'truck', route: '/my-orders', query: { aba: 'shipping' } },
    { label: 'Devoluções', icon: 'returns', route: '/my-orders', query: { aba: 'refund' } },
    { label: 'Mensagens', icon: 'chat', route: '/tabs/chats' },
  ],
  sell: [
    { label: 'Anunciar produto', icon: 'plus', route: '/upload-product' },
    { label: 'Minhas vendas', icon: 'chart', route: '/my-sales' },
    { label: 'Meus anúncios', icon: 'tag', route: '/my-products' },
    { label: 'Notas fiscais', icon: 'receipt', route: '/my-invoices' },
  ],
};

const CONTACT_BODY = [
  'Número do pedido (está em Minhas compras):',
  '',
  'O que aconteceu:',
  '',
].join('\n');

/**
 * Central de ajuda (`/help`): busca, atalhos, assuntos e perguntas para quem
 * compra e para quem vende. Rota aberta, sem guard — quem ainda nem tem conta
 * também tira dúvida.
 *
 * Estado na URL, para link e botão voltar funcionarem:
 *   `?perfil=vender`  visão de quem vende (sem o parâmetro: quem compra)
 *   `?assunto=<id>`   abre um assunto
 *   `?pergunta=<id>`  abre a pergunta (e o assunto dela) e rola até ela
 * A busca não vai para a URL.
 */
@Component({
  selector: 'app-help',
  templateUrl: './help.page.html',
  styleUrls: ['./help.page.scss'],
  standalone: true,
  imports: [IonicModule, NgTemplateOutlet, RouterLink, VnIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HelpPage {
  private readonly navCtrl = inject(NavController);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly content = viewChild.required(IonContent);

  readonly company = COMPANY;
  readonly contactMailto = COMPANY.supportEmail
    ? `mailto:${COMPANY.supportEmail}?subject=${encodeURIComponent('Preciso de ajuda')}&body=${encodeURIComponent(CONTACT_BODY)}`
    : null;

  readonly profile = signal<HelpProfile>('buy');
  readonly topicId = signal<string | null>(null);
  readonly query = signal('');
  readonly open = signal<ReadonlySet<string>>(new Set());
  /** Última pergunta aberta: vai junto no pedido de atendimento (mede o que a Central não resolveu). */
  private readonly lastOpened = signal<string | null>(null);

  readonly topic = computed(() => findTopic(this.topicId()));
  readonly topics = computed(() => topicsFor(this.profile()));
  readonly popular = computed(() => popularFor(this.profile()));
  readonly shortcuts = computed(() => SHORTCUTS[this.profile()]);
  readonly searching = computed(() => this.query().trim().length > 0);
  readonly results = computed(() => searchHelp(this.query()));
  readonly total = HELP_TOPICS.reduce((n, t) => n + t.articles.length, 0);

  private readonly segmentCache = new Map<string, HelpSegment[]>();

  constructor() {
    inject(ActivatedRoute).queryParamMap.pipe(takeUntilDestroyed()).subscribe(params => {
      const perfil: HelpProfile = params.get('perfil') === 'vender' ? 'sell' : 'buy';
      const pergunta = params.get('pergunta');
      const hit = pergunta ? findArticle(pergunta) : undefined;
      const assunto = hit?.topic.id ?? (findTopic(params.get('assunto'))?.id ?? null);
      const topicProfile = findTopic(assunto)?.profile;

      // Assunto de quem vende puxa a visão de quem vende, mesmo sem `perfil` na URL.
      this.profile.set(topicProfile === 'sell' ? 'sell' : topicProfile === 'buy' ? 'buy' : perfil);
      this.topicId.set(assunto);
      this.query.set('');

      if (hit) {
        this.open.update(set => new Set(set).add(hit.article.id));
        this.afterRender(() => void this.scrollToId(`a-${hit.article.id}`));
      } else {
        this.afterRender(() => void this.content().scrollToTop(0));
      }
    });
  }

  // ----------------------------------------------------------------- busca

  onSearch(value: string) {
    this.query.set(value);
  }

  clearSearch(input?: HTMLInputElement) {
    this.query.set('');
    if (input) {
      input.value = '';
      input.focus();
    }
  }

  // ------------------------------------------------------------ navegação

  setProfile(profile: HelpProfile) {
    if (profile === this.profile()) return;
    this.profile.set(profile);
    void this.router.navigate([], {
      queryParams: { perfil: profile === 'sell' ? 'vender' : null, assunto: null, pergunta: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** Parâmetros do link para uma pergunta da Central (o assunto vem junto). */
  articleQuery(id: string): { assunto: string | null; pergunta: string } {
    return { assunto: findArticle(id)?.topic.id ?? null, pergunta: id };
  }

  goBack(): void {
    if (window.history.length > 1) this.navCtrl.back();
    else void this.navCtrl.navigateRoot('/');
  }

  // ------------------------------------------------------------ perguntas

  isOpen(id: string): boolean {
    return this.open().has(id);
  }

  toggle(id: string) {
    this.open.update(set => {
      const next = new Set(set);
      if (!next.delete(id)) {
        next.add(id);
        this.lastOpened.set(id);
      }
      return next;
    });
  }

  /** Parâmetros de `/support/new`: se a pessoa estava lendo uma pergunta, o atendimento sabe de qual veio. */
  contactQuery(): { de: string } | null {
    const id = this.lastOpened();
    return id && this.isOpen(id) ? { de: id } : null;
  }

  /** `**negrito**` → trechos; guardado para o template não refazer a cada ciclo. */
  parts(text: string): HelpSegment[] {
    let cached = this.segmentCache.get(text);
    if (!cached) {
      cached = segments(text);
      this.segmentCache.set(text, cached);
    }
    return cached;
  }

  // --------------------------------------------------------------- rolagem

  private afterRender(fn: () => void) {
    afterNextRender(fn, { injector: this.injector });
  }

  /** `scrollIntoView` não alcança o scroll do ion-content; o deslocamento é calculado à mão. */
  private async scrollToId(id: string): Promise<void> {
    const target = this.host.nativeElement.querySelector(`#${id}`) as HTMLElement | null;
    if (!target) return;
    const content = this.content();
    const scroller = await content.getScrollElement();
    const offset = window.matchMedia('(min-width: 992px)').matches ? 16 : 12;
    const delta = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - offset;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    await content.scrollByPoint(0, delta, reduce ? 0 : 400);
  }
}
