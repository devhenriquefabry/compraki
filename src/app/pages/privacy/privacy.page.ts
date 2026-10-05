import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonContent, IonicModule, NavController, ToastController } from '@ionic/angular';
import { User } from 'firebase/auth';

import { onAuthUserChanged } from '../../core/auth-state';
import { LegalIndex } from '../../core/legal-index';
import { PrivacyCounts, buildMyDataExport, countMyData, downloadJson } from '../../core/privacy-export';
import { COMPANY, PRIVACY_POLICY_UPDATED, formatLegalDate, mailtoLink } from '../../core/legal-info';
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
  readonly controller = COMPANY;
  readonly updatedLabel = formatLegalDate(PRIVACY_POLICY_UPDATED);

  readonly authResolved = signal(false);
  readonly user = signal<User | null>(null);
  readonly appUser = signal<AppUser | null>(null);
  readonly counts = signal<PrivacyCounts | null>(null);
  readonly countsFailed = signal(false);
  readonly exporting = signal(false);

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

  readonly dpoMailto = mailtoLink(COMPANY.dpoEmail, 'Pedido sobre meus dados pessoais (LGPD)');

  readonly index = new LegalIndex(this.host.nativeElement, () => this.content(), SECTIONS[0].id);

  constructor() {
    const destroyRef = inject(DestroyRef);
    const stopAuth = onAuthUserChanged(user => this.bindUser(user));
    destroyRef.onDestroy(() => {
      stopAuth();
      this.index.stop();
    });
  }

  ionViewDidEnter() {
    this.index.watch(SECTIONS.map(s => s.id));
  }

  ionViewWillLeave() {
    this.index.stop();
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
