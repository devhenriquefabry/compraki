import { ActivatedRouteSnapshot } from '@angular/router';
import { IonicRouteStrategy } from '@ionic/angular';

/**
 * O `IonicRouteStrategy` cria uma página nova (com animação de empilhar)
 * sempre que um parâmetro da rota muda. Para rotas que são "uma tela com
 * seções" — como `/admin/:tab` —, isso recriava o painel inteiro a cada troca
 * de aba. Rotas com `data: { reuseAcrossParams: true }` mantêm a mesma página
 * e só recebem os parâmetros novos.
 */
export class AppRouteStrategy extends IonicRouteStrategy {
  override shouldReuseRoute(future: ActivatedRouteSnapshot, curr: ActivatedRouteSnapshot): boolean {
    if (future.routeConfig && future.routeConfig === curr.routeConfig && future.routeConfig.data?.['reuseAcrossParams']) {
      return true;
    }
    return super.shouldReuseRoute(future, curr);
  }
}
