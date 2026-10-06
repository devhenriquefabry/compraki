import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonContent, IonicModule, NavController } from '@ionic/angular';

import { COMPANY, TERMS_UPDATED, formatLegalDate, mailtoLink } from '../../core/legal-info';
import { LegalIndex } from '../../core/legal-index';
import { VnIconComponent } from '../../components/vn-icon/vn-icon.component';

type TermsTab = 'uso' | 'compras' | 'vendedores';

interface TermsDoc {
  id: TermsTab;
  tab: string;
  eyebrow: string;
  title: string;
  lead: string;
  summary: string[];
  sections: { id: string; title: string }[];
}

const DOCS: TermsDoc[] = [
  {
    id: 'uso',
    tab: 'Termos de uso',
    eyebrow: 'Termos de Uso',
    title: 'As regras da Vineon',
    lead: 'O combinado entre você, a Vineon e quem compra e vende aqui. Ao criar sua conta ou fazer um pedido, você concorda com estes termos.',
    summary: [
      'A Vineon é a plataforma; cada produto é anunciado e vendido por uma loja.',
      'Pague sempre pela Vineon: é o que protege a sua compra.',
      'O pagamento fica retido e só depois é liberado à loja.',
      'Seus direitos de consumidor valem sempre.',
    ],
    sections: [
      { id: 'u-quem', title: 'O que é a Vineon' },
      { id: 'u-aceite', title: 'Aceite e mudanças' },
      { id: 'u-conta', title: 'Sua conta' },
      { id: 'u-compra', title: 'Como funciona uma compra' },
      { id: 'u-retencao', title: 'Pagamento protegido' },
      { id: 'u-precos', title: 'Preços, ofertas e frete' },
      { id: 'u-conversas', title: 'Conversas e avaliações' },
      { id: 'u-proibido', title: 'O que não é permitido' },
      { id: 'u-moderacao', title: 'Denúncias e suspensão' },
      { id: 'u-responsabilidades', title: 'Responsabilidades' },
      { id: 'u-marca', title: 'Marca e conteúdo' },
      { id: 'u-encerrar', title: 'Encerrar a conta' },
      { id: 'u-foro', title: 'Lei e foro' },
      { id: 'u-contato', title: 'Fale com a Vineon' },
    ],
  },
  {
    id: 'compras',
    tab: 'Compras e devoluções',
    eyebrow: 'Política de Trocas e Devoluções',
    title: 'Comprou e não deu certo?',
    lead: 'Desistência, defeito, produto diferente do anúncio ou que não chegou: o que você pode pedir, em quanto tempo e como o dinheiro volta. Segue o Código de Defesa do Consumidor.',
    summary: [
      'Desistiu? Até 7 dias depois de receber, sem precisar explicar.',
      'Defeito: 30 dias (não duráveis) ou 90 dias (duráveis) para reclamar.',
      'Não chegou? Você recebe o dinheiro de volta.',
      'Devolução por desistência sem custo de frete para você.',
    ],
    sections: [
      { id: 'c-arrependimento', title: 'Desistência em 7 dias' },
      { id: 'c-defeito', title: 'Defeito ou diferente do anúncio' },
      { id: 'c-naochegou', title: 'Pedido que não chegou' },
      { id: 'c-como', title: 'Como pedir a devolução' },
      { id: 'c-reembolso', title: 'Como o dinheiro volta' },
      { id: 'c-cancelar', title: 'Cancelar antes do envio' },
      { id: 'c-nao-cabe', title: 'Quando não cabe devolução' },
      { id: 'c-garantia', title: 'Garantia do fabricante' },
    ],
  },
  {
    id: 'vendedores',
    tab: 'Para vendedores',
    eyebrow: 'Regras para vender',
    title: 'Vender na Vineon',
    lead: 'O que a loja precisa cumprir para anunciar, vender e receber: anúncios, itens proibidos, prazos de envio, taxa e repasse.',
    summary: [
      'Anuncie só o que você tem e descreva como ele é.',
      'Poste em até 2 dias úteis depois do pagamento.',
      'A taxa da Vineon incide só sobre os produtos, não sobre o frete.',
      'Os dados do comprador servem só para entregar o pedido.',
    ],
    sections: [
      { id: 'v-quem', title: 'Quem pode vender' },
      { id: 'v-anuncios', title: 'Anúncios' },
      { id: 'v-proibidos', title: 'Itens proibidos' },
      { id: 'v-envio', title: 'Vendas e envio' },
      { id: 'v-taxa', title: 'Taxa e repasse' },
      { id: 'v-devolucoes', title: 'Devoluções e reclamações' },
      { id: 'v-dados', title: 'Dados do comprador' },
      { id: 'v-medidas', title: 'Desempenho e medidas' },
    ],
  },
];

const TABS: TermsTab[] = DOCS.map(d => d.id);

/**
 * Termos e políticas: Termos de Uso, Política de Trocas e Devoluções e Regras
 * para vender, em abas (`?aba=uso|compras|vendedores`). A Política de
 * Privacidade tem tela própria (`/privacy`) e entra como quarta aba-link.
 *
 * O texto descreve o que o app faz de verdade (retenção do pagamento, prazo de
 * postagem, taxa sobre os produtos, moderação) e os direitos do Código de
 * Defesa do Consumidor. Rota aberta, sem guard.
 */
@Component({
  selector: 'app-terms',
  templateUrl: './terms.page.html',
  styleUrls: ['./terms.page.scss'],
  standalone: true,
  imports: [IonicModule, RouterLink, VnIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TermsPage {
  private readonly navCtrl = inject(NavController);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly content = viewChild.required(IonContent);

  readonly docs = DOCS;
  readonly company = COMPANY;
  readonly updatedLabel = formatLegalDate(TERMS_UPDATED);
  readonly supportMailto = mailtoLink(COMPANY.supportEmail, 'Atendimento Vineon');

  readonly tab = signal<TermsTab>('uso');
  readonly doc = computed(() => DOCS.find(d => d.id === this.tab())!);
  readonly index = new LegalIndex(this.host.nativeElement, () => this.content(), DOCS[0].sections[0].id);
  private entered = false;

  constructor() {
    inject(ActivatedRoute).queryParamMap.pipe(takeUntilDestroyed()).subscribe(params => {
      const aba = params.get('aba') as TermsTab | null;
      const next = aba && TABS.includes(aba) ? aba : 'uso';
      if (next !== this.tab()) this.showTab(next, false);
    });
    inject(DestroyRef).onDestroy(() => this.index.stop());
  }

  ionViewDidEnter() {
    this.entered = true;
    this.index.watch(this.doc().sections.map(s => s.id));
    this.revealTab();
  }

  ionViewWillLeave() {
    this.entered = false;
    this.index.stop();
  }

  /** Troca de aba: atualiza a URL (sem empilhar histórico), volta ao topo e reinicia o índice. */
  showTab(tab: TermsTab, updateUrl = true) {
    this.tab.set(tab);
    this.index.active.set(this.doc().sections[0].id);
    if (updateUrl) {
      void this.router.navigate([], { queryParams: { aba: tab === 'uso' ? null : tab }, queryParamsHandling: 'merge', replaceUrl: true });
    }
    afterNextRender(() => {
      void this.content().scrollToTop(0);
      this.revealTab();
      if (this.entered) this.index.watch(this.doc().sections.map(s => s.id));
    }, { injector: this.injector });
  }

  /** No celular as abas não cabem: traz a aba ativa para a vista. */
  private revealTab() {
    const bar = this.host.nativeElement.querySelector('.pg-tabs') as HTMLElement | null;
    const active = bar?.querySelector('.pg-tab.is-active') as HTMLElement | null;
    if (!bar || !active || bar.scrollWidth <= bar.clientWidth) return;
    bar.scrollTo({ left: active.offsetLeft - (bar.clientWidth - active.offsetWidth) / 2, behavior: 'smooth' });
  }

  goBack(): void {
    if (window.history.length > 1) this.navCtrl.back();
    else this.navCtrl.navigateRoot('/');
  }
}
