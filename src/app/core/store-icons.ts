import { VN_ICONS } from './vn-icons';

/**
 * Ícones das telas da loja ("Minha vitrine" e a página pública da loja): os do
 * Vineon (`core/vn-icons.ts`, mesma grade 24 e traço 1.75) mais os que só elas
 * usam. Ficam aqui, e não em `VN_ICONS`, porque aquele arquivo vai no bundle
 * inicial (barra inferior e Menu), que está no limite do orçamento de 2 MB.
 * Desenhar com `<svg class="ic" viewBox="0 0 24 24"><path [attr.d]="ic.x" /></svg>`.
 */
export const STORE_ICONS = {
  arrowLeft: VN_ICONS.arrowLeft,
  close: VN_ICONS.close,
  camera: VN_ICONS.camera,
  trash: VN_ICONS.trash,
  check: VN_ICONS.check,
  store: VN_ICONS.store,
  heart: VN_ICONS.heart,
  chat: VN_ICONS.chat,
  plus: VN_ICONS.plus,
  pencil: VN_ICONS.pencil,
  share: VN_ICONS.share,
  star: VN_ICONS.star,
  ticket: VN_ICONS.ticket,
  truck: VN_ICONS.truck,
  card: VN_ICONS.card,
  box: VN_ICONS.box,
  shield: VN_ICONS.shield,
  clock: VN_ICONS.clock,
  chevron: VN_ICONS.chevron,
  cart: VN_ICONS.cart,
  tag: VN_ICONS.tag,
  bag: VN_ICONS.bag,
  qr: 'M4.75 4.75h5v5h-5Z M14.25 4.75h5v5h-5Z M4.75 14.25h5v5h-5Z M14.25 14.25h2.25v2.25 M19.25 14.25v.05 M14.25 19.25v.05 M16.5 16.5h2.75v2.75h-2.75',
  cash: 'M3.75 6.75h16.5v10.5H3.75Z M12 14.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z M6.75 9.75v.05 M17.25 14.25v.05',
  gift: 'M4.25 9.25h15.5v3.5H4.25Z M5.5 12.75h13v7H5.5Z M12 9.25v10.5 M12 9.25S10.9 5 8.6 5.05c-1.2 0-1.9.9-1.85 1.9.05 1.4 1.6 2.3 5.25 2.3Z M12 9.25s1.1-4.25 3.4-4.2c1.2 0 1.9.9 1.85 1.9-.05 1.4-1.6 2.3-5.25 2.3Z',
  bolt: 'M13.25 3.75 5.75 13.5h6l-1 6.75 7.5-9.75h-6Z',
  info: 'M12 20.25a8.25 8.25 0 1 0 0-16.5 8.25 8.25 0 0 0 0 16.5Z M12 11v5 M12 7.9v.05',
  search: 'M10.75 17.5a6.75 6.75 0 1 0 0-13.5 6.75 6.75 0 0 0 0 13.5Z M15.6 15.6l4.65 4.65',
  flag: 'M5.25 20.5V4.25 M5.25 4.75h11.5l-2.25 4 2.25 4H5.25',
  sort: 'M7.5 4.75v14.5 M4.25 16l3.25 3.25L10.75 16 M16.5 19.25V4.75 M13.25 8l3.25-3.25L19.75 8',
  image: 'M5.25 4.75h13.5a1 1 0 0 1 1 1v12.5a1 1 0 0 1-1 1H5.25a1 1 0 0 1-1-1V5.75a1 1 0 0 1 1-1Z M4.5 15.75l4.25-4.25 4 4 2.5-2.5 4.5 4.5 M15.5 10a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z',
  palette: 'M12 20.25a8.25 8.25 0 1 1 8.25-8.25c0 2.1-1.7 3.25-3.5 3.25h-1.6a1.65 1.65 0 0 0-1.2 2.8c.75.8.25 2.2-1.95 2.2Z M7.75 11.75v.05 M10.25 7.75v.05 M14.5 7.75v.05',
  text: 'M5 6.25V4.75h14v1.5 M12 4.75v14.5 M9.25 19.25h5.5',
  copy: 'M9.25 8.75h9a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9.5a1 1 0 0 1 1-1Z M4.75 15.25v-9.5a1 1 0 0 1 1-1h9.5',
  external: 'M13.75 4.75h5.5v5.5 M19.25 4.75 11.5 12.5 M17.25 13.75v4.5a1 1 0 0 1-1 1H5.75a1 1 0 0 1-1-1V7.75a1 1 0 0 1 1-1h4.5',
  smartphone: 'M8 2.75h8c.7 0 1.25.55 1.25 1.25v16c0 .7-.55 1.25-1.25 1.25H8c-.7 0-1.25-.55-1.25-1.25V4c0-.7.55-1.25 1.25-1.25Z M11 18.25h2',
  monitor: 'M4 4.75h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1Z M9 20.25h6 M12 16.75v3.5',
  crop: 'M7 3v13a1 1 0 0 0 1 1h13 M3 7h13a1 1 0 0 1 1 1v13',
  minus: 'M5.75 12h12.5',
  alert: 'M12 4.5 20.75 19.5H3.25Z M12 10v4 M12 16.75v.05',
  instagram: 'M7.75 3.75h8.5a4 4 0 0 1 4 4v8.5a4 4 0 0 1-4 4h-8.5a4 4 0 0 1-4-4v-8.5a4 4 0 0 1 4-4Z M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M16.9 7.1v.05',
  whatsapp: 'M4.5 19.5l1.15-3.75A8.25 8.25 0 1 1 8.6 18.6Z M9.35 8.2c.35-.3.85-.25 1.05.15l.75 1.5c.15.3.1.65-.15.9l-.5.5a5.6 5.6 0 0 0 2.3 2.3l.5-.5c.25-.25.6-.3.9-.15l1.5.75c.4.2.45.7.15 1.05-.65.75-1.65 1-2.6.65a7.6 7.6 0 0 1-4.55-4.55c-.35-.95-.1-1.95.65-2.6Z',
} as const;

export type StoreIcon = keyof typeof STORE_ICONS;
