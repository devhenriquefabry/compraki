import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonContent, IonicModule, NavController, ToastController } from '@ionic/angular';
import { User } from 'firebase/auth';

import { onAuthUserChanged } from '../../core/auth-state';
import { PrivacyCounts, buildMyDataExport, countMyData, downloadJson } from '../../core/privacy-export';
import { PRIVACY_CONTROLLER, PRIVACY_POLICY_UPDATED } from '../../core/privacy-policy';
import { MONTHS_LONG } from '../../core/order-stage';
import { VnIconName } from '../../core/vn-icons';
import { VnIconComponent } from '../../components/vn-icon/vn-icon.component';
import { AppUser } from '../../interfaces/app-user';
import { FirebaseUsersService } from '../../services/firebase-users.service';

interface PolicySection {
  id: string;
  title: string;
}

/** Linha do painel "O que a Vineon guarda sobre você". */
interface HeldRow {
  icon: VnIconName;
  label: string;
  value: string;
  missing?: boolean;
}

const SECTIONS: PolicySection[] = [
  { id: 'quem-somos', title: 'Quem cuida dos seus dados' },
  { id: 'dados', title: 'Dados que coletamos' },
  { id: 'finalidades', title: 'Para que usamos' },
  { id: 'compartilhamento', title: 'Com quem compartilhamos' },
  { id: 'publico', title: 'O que fica público' },
  { id: 'internacional', title: 'Dados fora do Brasil' },
  { id: 'retencao', title: 'Por quanto tempo guardamos' },
  { id: 'aparelho', title: 'Cookies e armazenamento' },
  { id: 'seguranca', title: 'Como protegemos' },
  { id: 'direitos', title: 'Seus direitos' },
  { id: 'menores', title: 'Menores de idade' },
  { id: 'mudancas', title: 'Mudanças nesta política' },
  { id: 'contato', title: 'Fale com o encarregado' },
];

/**
 * Privacidade e dados: a Política de Privacidade da Vineon (LGPD, Lei
 * 13.709/2018) escrita a partir do que o app realmente coleta, e — para quem
 * está logado — o painel com o que a Vineon guarda sobre a pessoa e o botão
 * para baixar uma cópia.
 *
 * Rota aberta, sem guard: a política precisa ser lida antes de criar a conta.
 */
@Component({
  selector: 'app-privacy',
  templateUrl: './privacy.page.html',
  styleUrls: ['./privacy.page.scss'],
  standalone: true,
  imports: [IonicModule, RouterLink, VnIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrivacyPage {
  private readonly usersService = inject(FirebaseUsersService);
  private readonly navCtrl = inject(NavController);
  private readonly toastCtrl = inject(ToastController);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly content = viewChild.required(IonContent);

  readonly sections = SECTIONS;
  readonly controller = PRIVACY_CONTROLLER;
  readonly updatedLabel = formatLongDate(PRIVACY_POLICY_UPDATED);

  readonly authResolved = signal(false);
  readonly user = signal<User | null>(null);
  readonly appUser = signal<AppUser | null>(null);
  readonly counts = signal<PrivacyCounts | null>(null);
  readonly countsFailed = signal(false);
  readonly exporting = signal(false);
  readonly activeSection = signal(SECTIONS[0].id);

  /** Controlador com algum dado de identificação preenchido. */
  readonly hasControllerData = !!(this.controller.legalName || this.controller.cnpj || this.controller.address);

  readonly heldRows = computed<HeldRow[]>(() => {
    const user = this.user();
    const profile = this.appUser();
    if (!user) return [];
    const counts = this.counts();
    const counted = (n: number | null | undefined, one: string, many: string, none: string) => {
      if (n === undefined) return this.countsFailed() ? 'Não foi possível contar agora' : '…';
      if (n === null) return 'Não foi possível contar agora';
      return n === 0 ? none : `${n} ${n === 1 ? one : many}`;
    };
    const phone = profile?.phoneNumber || user.phoneNumber;

    return [
      { icon: 'account', label: 'Nome', value: profile?.displayName || user.displayName || 'Não informado', missing: !(profile?.displayName || user.displayName) },
      { icon: 'mail', label: 'E-mail', value: user.email || 'Não informado', missing: !user.email },
      { icon: 'idcard', label: 'CPF', value: profile?.cpf ? maskCpf(profile.cpf) : 'Não informado', missing: !profile?.cpf },
      { icon: 'phone', label: 'Telefone', value: phone ? maskPhone(phone) : 'Não informado', missing: !phone },
      { icon: 'pin', label: 'Endereços', value: counted(counts?.addresses, 'endereço', 'endereços', 'Nenhum') },
      { icon: 'bag', label: 'Pedidos', value: counted(counts?.orders, 'pedido', 'pedidos', 'Nenhum') },
      { icon: 'chat', label: 'Conversas', value: counted(counts?.chats, 'conversa', 'conversas', 'Nenhuma') },
      { icon: 'heart', label: 'Favoritos', value: counted(counts?.saved, 'produto', 'produtos', 'Nenhum') },
    ];
  });

  readonly memberSince = computed(() => {
    const created = this.user()?.metadata.creationTime;
    if (!created) return null;
    const date = new Date(created);
    return `${MONTHS_LONG[date.getMonth()]} de ${date.getFullYear()}`;
  });

  readonly dpoMailto = computed(() => {
    const email = this.controller.dpoEmail;
    if (!email) return null;
    const subject = encodeURIComponent('Pedido sobre meus dados pessoais (LGPD)');
    return `mailto:${email}?subject=${subject}`;
  });

  private observer?: IntersectionObserver;

  constructor() {
    const destroyRef = inject(DestroyRef);
    const stopAuth = onAuthUserChanged(user => this.bindUser(user));
    destroyRef.onDestroy(() => {
      stopAuth();
      this.observer?.disconnect();
    });
  }

  ionViewDidEnter() {
    this.watchSections();
  }

  ionViewWillLeave() {
    this.observer?.disconnect();
  }

  private bindUser(user: User | null) {
    this.authResolved.set(true);
    if (user?.uid === this.user()?.uid) return;
    this.user.set(user);
    this.appUser.set(null);
    this.counts.set(null);
    this.countsFailed.set(false);
    if (!user) return;

    this.usersService.getUserById(user.uid).then(profile => this.appUser.set(profile)).catch(() => undefined);
    countMyData(user.uid)
      .then(counts => this.counts.set(counts))
      .catch(err => {
        console.error('Privacidade: falha ao contar dados', err);
        this.countsFailed.set(true);
      });
  }

  /** Índice acompanha a seção que está na tela (só aparece fixo no computador). */
  private watchSections() {
    this.observer?.disconnect();
    // Faixa de leitura = terço de cima da tela. Quando o fim de uma seção e o
    // começo da seguinte dividem a faixa, vale a seguinte (a que está chegando).
    const visible = new Set<string>();
    this.observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target.id);
        else visible.delete(entry.target.id);
      }
      const current = [...SECTIONS].reverse().find(s => visible.has(s.id));
      if (current && current.id !== this.activeSection()) {
        this.activeSection.set(current.id);
        this.revealChip(current.id);
      }
    }, { rootMargin: '0px 0px -65% 0px' });

    for (const section of SECTIONS) {
      const el = this.host.nativeElement.querySelector(`#${section.id}`);
      if (el) this.observer.observe(el);
    }
  }

  /** No celular o índice é uma fila de chips: traz o chip da seção atual para a vista. */
  private revealChip(id: string) {
    const list = this.host.nativeElement.querySelector('.pv-index ol') as HTMLElement | null;
    const chip = list?.querySelector(`[data-section="${id}"]`) as HTMLElement | null;
    if (!list || !chip || list.scrollWidth <= list.clientWidth) return;
    list.scrollTo({ left: chip.offsetLeft - (list.clientWidth - chip.offsetWidth) / 2, behavior: 'smooth' });
  }

  /** `scrollIntoView` não alcança o scroll do ion-content; o deslocamento respeita o `scroll-margin-top` da seção. */
  async goTo(id: string) {
    this.activeSection.set(id);
    this.revealChip(id);
    const target = this.host.nativeElement.querySelector(`#${id}`) as HTMLElement | null;
    if (!target) return;
    const scroller = await this.content().getScrollElement();
    const margin = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
    const delta = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - margin;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    await this.content().scrollByPoint(0, delta, reduce ? 0 : 400);
  }

  async downloadMyData() {
    const user = this.user();
    if (!user || this.exporting()) return;
    this.exporting.set(true);
    try {
      downloadJson(await buildMyDataExport(user));
      await this.toast('Pronto. O arquivo com seus dados foi baixado.');
    } catch (err) {
      console.error('Privacidade: falha ao exportar dados', err);
      await this.toast('Não foi possível gerar o arquivo agora. Confira a conexão e tente de novo.');
    } finally {
      this.exporting.set(false);
    }
  }

  goBack(): void {
    if (window.history.length > 1) this.navCtrl.back();
    else this.navCtrl.navigateRoot(this.user() ? '/tabs/my-account' : '/');
  }

  private async toast(message: string): Promise<void> {
    const toast = await this.toastCtrl.create({ message, duration: 3200, position: 'top', color: 'dark' });
    await toast.present();
  }
}

/** "2026-10-05" → "5 de outubro de 2026". */
function formatLongDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} de ${MONTHS_LONG[m - 1]} de ${y}`;
}

/** Mostra só os dois últimos dígitos: •••.•••.•••-45. */
function maskCpf(cpf: string): string {
  const digits = cpf.replace(/\D/g, '');
  return digits.length >= 2 ? `•••.•••.•••-${digits.slice(-2)}` : 'Informado';
}

/** Mostra DDD e os quatro últimos: (11) •••••-1234. */
function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (digits.length < 6) return 'Informado';
  return `(${digits.slice(0, 2)}) •••••-${digits.slice(-4)}`;
}
