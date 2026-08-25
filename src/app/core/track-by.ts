/**
 * `trackBy` padrão para listas de entidades.
 *
 * Sem `trackBy`, o Angular descarta e recria TODOS os nós da lista a cada
 * emissão — mesmo que só um item tenha mudado. Numa grade de produtos isso
 * significa recriar cada card e rebaixar cada imagem.
 *
 * Aceita `id` ou `uid` como identidade, porque as duas convenções convivem no
 * projeto (`Product.id`, `AppUser.uid`), e cai no índice quando não há nenhum.
 *
 * Uso no componente:
 *   public trackById = trackById;
 * e no template:
 *   *ngFor="let p of produtos; trackBy: trackById"
 */
export function trackById<T>(index: number, item: T): string | number {
  const entity = item as { id?: string | number; uid?: string } | null;
  return entity?.id ?? entity?.uid ?? index;
}
