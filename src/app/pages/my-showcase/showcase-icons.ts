import { VN_ICONS } from '../../core/vn-icons';

/**
 * Ícones da "Minha vitrine": os do Vineon (`core/vn-icons.ts`, mesma grade 24 e
 * traço 1.75) mais os que só esta tela usa. Ficam aqui, e não em `VN_ICONS`,
 * porque aquele arquivo vai no bundle inicial (barra inferior e Menu), que está
 * no limite do orçamento de 2 MB.
 */
export const SHOWCASE_ICONS = {
  arrowLeft: VN_ICONS.arrowLeft,
  close: VN_ICONS.close,
  camera: VN_ICONS.camera,
  trash: VN_ICONS.trash,
  check: VN_ICONS.check,
  store: VN_ICONS.store,
  heart: VN_ICONS.heart,
  chat: VN_ICONS.chat,
  plus: VN_ICONS.plus,
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

export type ShowcaseIcon = keyof typeof SHOWCASE_ICONS;
