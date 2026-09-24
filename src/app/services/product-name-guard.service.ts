import { Injectable, inject } from '@angular/core';
import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { AlertController } from '@ionic/angular';
import { Subscription, debounceTime, distinctUntilChanged, map } from 'rxjs';

import { findBlockedWord } from '../core/product-moderation';
import { AppConfigService } from './app-config.service';

/**
 * Barra, no campo de título do anúncio, os termos que o admin cadastrou como
 * proibidos (aba Ajustes do painel).
 *
 * É a primeira camada: avisa na hora e trava o botão de publicar. A segunda é
 * a função `moderateProductName`, que tira do ar o que passar por aqui (app
 * antigo, chamada direta ao Firestore, lista alterada depois).
 */
@Injectable({ providedIn: 'root' })
export class ProductNameGuardService {
  private readonly appConfig = inject(AppConfigService);
  private readonly alertCtrl = inject(AlertController);

  /** Termo proibido presente no título, ou `null`. */
  check(title: string | null | undefined): string | null {
    return findBlockedWord(title || '', this.appConfig.config().blockedWords);
  }

  /** Validador: erro `blockedWord` com o termo encontrado. */
  validator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const term = this.check(control.value);
      return term ? { blockedWord: term } : null;
    };
  }

  /**
   * Mostra o aviso enquanto a pessoa digita. Espera uma pausa curta para não
   * disparar no meio de uma palavra ("arma" a caminho de "armário") e avisa
   * uma vez por termo.
   */
  watch(control: AbstractControl): Subscription {
    return control.valueChanges.pipe(
      debounceTime(450),
      map(value => this.check(value)),
      distinctUntilChanged()
    ).subscribe(term => {
      if (term) void this.showBlockedAlert();
    });
  }

  async showBlockedAlert(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Produto não permitido',
      message: 'Esse produto não é aceito no Vineon. Anúncios desse tipo violam os termos de uso e não podem ser publicados.',
      buttons: ['Entendi'],
      cssClass: 'vn-blocked-alert',
    });
    await alert.present();
  }
}
