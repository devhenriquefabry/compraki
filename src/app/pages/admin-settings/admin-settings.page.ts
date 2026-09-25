import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AlertController, IonicModule, ToastController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  banOutline, closeOutline, giftOutline, logoFacebook, logoInstagram, logoTiktok, logoWhatsapp, logoX, logoYoutube,
  shareSocialOutline,
} from 'ionicons/icons';

import { DEFAULT_COMMISSION_RATE, MAX_COMMISSION_RATE, formatRate } from '../../core/commission';
import { findBlockedWord } from '../../core/product-moderation';
import { SOCIAL_NETWORKS, SocialLinks } from '../../interfaces/app-config';
import { AppConfigService } from '../../services/app-config.service';

/**
 * Aba "Ajustes" do painel: o que o dono da loja liga e desliga sem deploy.
 * Grava em `appConfig/storefront`; vitrine, ficha, carrinho, checkout e
 * rodapé leem esse documento em tempo real.
 */
@Component({
  selector: 'app-admin-settings',
  templateUrl: './admin-settings.page.html',
  styleUrls: ['./admin-settings.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
})
export class AdminSettingsPage {
  private readonly appConfig = inject(AppConfigService);
  private readonly toastCtrl = inject(ToastController);
  private readonly alertCtrl = inject(AlertController);

  readonly config = this.appConfig.config;
  readonly loaded = this.appConfig.loaded;
  readonly networks = SOCIAL_NETWORKS;

  // ---- taxa da Vineon (em %, como o admin digita)
  readonly ratePresets = [5, 8, 10, 12, 15];
  readonly maxRatePercent = MAX_COMMISSION_RATE * 100;
  ratePercent: number | null = null;
  readonly savingRate = signal(false);
  readonly commission = computed(() => this.config().commission);
  /** Mudanças da mais nova para a mais antiga, e a taxa inicial no fim. */
  readonly rateHistory = computed(() => {
    const history = [...this.commission().history].reverse();
    return history.map((change, i) => ({
      label: formatRate(change.rate),
      since: new Date(change.since),
      current: i === 0,
    }));
  });
  readonly initialRate = formatRate(DEFAULT_COMMISSION_RATE);

  // ---- frete grátis
  minValue: number | null = null;
  readonly savingShipping = signal(false);

  // ---- palavras proibidas
  newWord = '';
  testTitle = '';
  readonly savingWords = signal(false);
  readonly words = computed(() => this.config().blockedWords);

  // ---- redes sociais
  social: SocialLinks = {};
  readonly savingSocial = signal(false);

  constructor() {
    addIcons({
      banOutline, closeOutline, giftOutline, logoFacebook, logoInstagram, logoTiktok, logoWhatsapp, logoX, logoYoutube,
      shareSocialOutline,
    });

    // Preenche os campos quando o documento chega (e quando outro admin muda),
    // sem atropelar o que está sendo digitado aqui.
    effect(() => {
      const cfg = this.config();
      if (!this.loaded()) return;
      untracked(() => {
        if (!this.savingShipping()) this.minValue = cfg.freeShipping.minValue;
        if (!this.savingRate()) this.ratePercent = Math.round(cfg.commission.rate * 1000) / 10;
        if (!this.savingSocial()) this.social = { ...cfg.socialLinks };
      });
    });
  }

  // ------------------------------------------------------------ taxa da Vineon

  formatRate = formatRate;

  get rateValid(): boolean {
    return typeof this.ratePercent === 'number' && this.ratePercent >= 0 && this.ratePercent <= this.maxRatePercent;
  }

  get rateDirty(): boolean {
    return this.rateValid && Math.abs(this.ratePercent! / 100 - this.commission().rate) > 0.00001;
  }

  /** Simulação ao vivo: uma venda de R$ 100,00 com a taxa digitada. */
  get ratePreview(): { fee: number; net: number } {
    const pct = this.rateValid ? this.ratePercent! : this.commission().rate * 100;
    const fee = Math.round(pct * 100) / 100;
    return { fee, net: 100 - fee };
  }

  pickRate(pct: number) {
    this.ratePercent = pct;
  }

  async saveRate() {
    if (!this.rateDirty) return;
    const next = this.ratePercent! / 100;
    const alert = await this.alertCtrl.create({
      header: `Mudar a taxa para ${formatRate(next)}?`,
      message: `Vale para todos os produtos, nas vendas pagas a partir de agora. ` +
        `As vendas anteriores e as notas já enviadas continuam com ${formatRate(this.commission().rate)}.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Mudar taxa', role: 'confirm' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role !== 'confirm') return;

    this.savingRate.set(true);
    try {
      await this.appConfig.saveCommissionRate(next);
      this.toast(`Taxa da Vineon agora é ${formatRate(next)}.`, 'success');
    } catch (err) {
      console.error(err);
      this.toast('Não foi possível salvar a taxa. Confira sua conexão e seu acesso de admin.', 'danger');
    } finally {
      this.savingRate.set(false);
    }
  }

  // ------------------------------------------------------------ frete grátis

  get shippingDirty(): boolean {
    return this.minValue !== this.config().freeShipping.minValue;
  }

  get minValueValid(): boolean {
    return typeof this.minValue === 'number' && this.minValue > 0 && this.minValue < 1_000_000;
  }

  /** O liga/desliga grava na hora: é o botão que o dono usa numa promoção. */
  async toggleFreeShipping(enabled: boolean) {
    const current = this.config().freeShipping;
    await this.saveShipping({ enabled, minValue: this.minValueValid ? this.minValue! : current.minValue },
      enabled ? 'Frete grátis ligado. Já aparece nos produtos.' : 'Frete grátis desligado.');
  }

  async saveMinValue() {
    if (!this.minValueValid) return;
    await this.saveShipping({ enabled: this.config().freeShipping.enabled, minValue: this.minValue! }, 'Valor mínimo salvo.');
  }

  private async saveShipping(rule: { enabled: boolean; minValue: number }, success: string) {
    this.savingShipping.set(true);
    try {
      await this.appConfig.saveFreeShipping(rule);
      this.toast(success, 'success');
    } catch (err) {
      console.error(err);
      this.toast('Não foi possível salvar. Confira sua conexão e seu acesso de admin.', 'danger');
    } finally {
      this.savingShipping.set(false);
    }
  }

  formatBRL(value: number): string {
    return (value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  // ------------------------------------------------------ palavras proibidas

  get testResult(): string | null {
    return this.testTitle.trim() ? findBlockedWord(this.testTitle, this.words()) : null;
  }

  async addWord() {
    // Aceita várias de uma vez, separadas por vírgula ou quebra de linha.
    const incoming = this.newWord.split(/[,\n;]/).map(w => w.trim().toLowerCase()).filter(Boolean);
    if (!incoming.length) return;
    const next = Array.from(new Set([...this.words(), ...incoming]));
    if (next.length === this.words().length) {
      this.newWord = '';
      this.toast('Esse termo já está na lista.', 'medium');
      return;
    }
    await this.saveWords(next, incoming.length === 1 ? `“${incoming[0]}” bloqueado.` : `${incoming.length} termos bloqueados.`);
    this.newWord = '';
  }

  async removeWord(word: string) {
    await this.saveWords(this.words().filter(w => w !== word), `“${word}” liberado.`);
  }

  private async saveWords(words: string[], success: string) {
    this.savingWords.set(true);
    try {
      await this.appConfig.saveBlockedWords(words);
      this.toast(success, 'success');
    } catch (err) {
      console.error(err);
      this.toast('Não foi possível salvar a lista.', 'danger');
    } finally {
      this.savingWords.set(false);
    }
  }

  // ----------------------------------------------------------- redes sociais

  async saveSocial() {
    this.savingSocial.set(true);
    try {
      await this.appConfig.saveSocialLinks(this.social);
      this.social = { ...this.config().socialLinks };
      this.toast('Redes sociais salvas. Já aparecem no rodapé do site e na tela Conta.', 'success');
    } catch (err) {
      console.error(err);
      this.toast('Não foi possível salvar as redes sociais.', 'danger');
    } finally {
      this.savingSocial.set(false);
    }
  }

  private async toast(message: string, color: string) {
    const t = await this.toastCtrl.create({ message, duration: 2600, color, position: 'bottom' });
    await t.present();
  }
}
