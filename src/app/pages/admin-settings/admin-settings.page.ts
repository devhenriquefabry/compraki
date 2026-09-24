import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  banOutline, closeOutline, giftOutline, logoFacebook, logoInstagram, logoTiktok, logoWhatsapp, logoX, logoYoutube,
  shareSocialOutline,
} from 'ionicons/icons';

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

  readonly config = this.appConfig.config;
  readonly loaded = this.appConfig.loaded;
  readonly networks = SOCIAL_NETWORKS;

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
        if (!this.savingSocial()) this.social = { ...cfg.socialLinks };
      });
    });
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
