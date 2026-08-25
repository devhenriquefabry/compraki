import { Injectable } from '@angular/core';
import { PreloadingStrategy, Route } from '@angular/router';
import { Observable, of, timer } from 'rxjs';
import { mergeMap } from 'rxjs/operators';

/**
 * Pré-carrega só as rotas marcadas com `data: { preload: true }`.
 *
 * Antes o app usava `PreloadAllModules`, que baixa TODAS as rotas logo após o
 * primeiro carregamento — inclusive o painel administrativo, o testador de
 * webhook e as telas de WhatsApp, que a esmagadora maioria dos usuários nunca
 * abre. Em rede móvel isso é banda gasta à toa e concorre com o que a pessoa
 * está tentando ver agora.
 *
 * Rotas sem a marca continuam carregando sob demanda, na navegação.
 */
@Injectable({ providedIn: 'root' })
export class SelectivePreloadStrategy implements PreloadingStrategy {
  /**
   * Pequeno atraso antes de pré-carregar: dá prioridade à primeira tela
   * terminar de renderizar antes de disputar rede.
   */
  private static readonly DELAY_MS = 2000;

  preload(route: Route, load: () => Observable<unknown>): Observable<unknown> {
    if (route.data?.['preload'] !== true) return of(null);

    return timer(SelectivePreloadStrategy.DELAY_MS).pipe(mergeMap(() => load()));
  }
}
