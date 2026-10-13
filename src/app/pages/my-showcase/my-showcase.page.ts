import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { AlertController, IonContent, ModalController, NavController, ToastController } from '@ionic/angular';
import { Subscription, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { waitForAuthUser } from 'src/app/core/auth-state';
import {
  SHOP_COLOR_DEFAULT, SHOP_COLOR_SWATCHES, normalizeHex, textOnShopColor,
} from 'src/app/core/shop-color';
import { BANNER_MOBILE_SAFE, SHOP_MEDIA, ShopMediaKind, shopImageProblem } from 'src/app/core/shop-media';
import { AppUser } from 'src/app/interfaces/app-user';
import { Product } from 'src/app/interfaces/product';
import { FirebaseProducts } from 'src/app/services/firebase-products';
import { FirebaseUsersService } from 'src/app/services/firebase-users.service';
import { ProductReviewsService } from 'src/app/services/product-reviews.service';
import { toDate } from 'src/app/core/order-stage';
import { environment } from 'src/environments/environment';
import { FramedImage, ImageFramerComponent } from './image-framer.component';
import { STORE_ICONS } from '../../core/store-icons';

interface ShowcaseForm {
  shopName: string;
  shopDescription: string;
  shopFeaturedTitle: string;
  shopBanner: string;
  photoURL: string;
  shopPrimaryColor: string;
  shopInstagram: string;
  shopWhatsApp: string;
}

type Device = 'phone' | 'desktop';

export const SHOWCASE_LIMITS = { name: 40, description: 300, featured: 40 };

/** Largura "de verdade" que a prévia desenha antes de reduzir para caber. */
const PREVIEW_WIDTH: Record<Device, number> = { phone: 390, desktop: 1180 };
/** Até onde a prévia mostra a página (px da página), antes do esfumado. */
const PREVIEW_MAX_HEIGHT: Record<Device, number> = { phone: 660, desktop: 780 };

const INSTAGRAM_HANDLE = /^[a-z0-9._]{1,30}$/i;

/**
 * Minha vitrine: como a loja aparece para quem compra.
 *
 * À esquerda (no celular, embaixo) o formulário; ao lado, uma prévia fiel da
 * página pública (`seller-profile`), no celular ou no computador, com os
 * produtos de verdade da loja. A capa e a foto passam pelo enquadramento
 * (`ImageFramerComponent`) e são gravadas no tamanho de `SHOP_MEDIA`, então o
 * que a prévia mostra é o que a loja mostra.
 *
 * Imagens sobem ao Storage assim que enquadradas, mas só entram na loja quando
 * a pessoa salva. O WhatsApp NÃO vem mais preenchido com o telefone da conta:
 * ele fica público, então a pessoa escolhe (há um atalho "Usar o da conta").
 */
@Component({
  selector: 'app-my-showcase',
  templateUrl: './my-showcase.page.html',
  styleUrls: ['./my-showcase.page.scss'],
  standalone: false
})
export class MyShowcasePage implements OnInit, OnDestroy {
  @ViewChild(IonContent) private content?: IonContent;

  readonly ic = STORE_ICONS;
  readonly media = SHOP_MEDIA;
  readonly mobileSafe = BANNER_MOBILE_SAFE;
  readonly limits = SHOWCASE_LIMITS;
  readonly swatches = SHOP_COLOR_SWATCHES;

  user: AppUser | null = null;
  loading = true;
  loadFailed = false;
  saving = false;

  form: ShowcaseForm = this.emptyForm();
  private savedSnapshot = '';

  device: Device = 'phone';
  showGuides = false;
  products: Product[] = [];
  productCount = 0;
  soldCount = 0;
  followerCount = 0;
  /** Mesma conta da página pública: média das avaliações verificadas da loja. */
  storeRating: { average: string; count: number } | null = null;

  uploading: Record<ShopMediaKind, boolean> = { banner: false, photo: false };
  /** Imagem recém-enquadrada, mostrada já enquanto sobe (e depois, sem piscar). */
  localPreview: Record<ShopMediaKind, string | null> = { banner: null, photo: null };

  instagramError = '';
  whatsAppError = '';
  linkCopied = false;

  private subs: Subscription[] = [];
  private resizeObserver?: ResizeObserver;
  private viewportEl?: HTMLElement;
  private pageEl?: HTMLElement;
  private copiedTimer?: ReturnType<typeof setTimeout>;

  private readonly productsService = inject(FirebaseProducts);
  private readonly usersService = inject(FirebaseUsersService);
  private readonly reviewsService = inject(ProductReviewsService);
  private readonly navCtrl = inject(NavController);
  private readonly toastCtrl = inject(ToastController);
  private readonly alertCtrl = inject(AlertController);
  private readonly modalCtrl = inject(ModalController);

  /** A prévia só existe depois do carregamento; o setter liga a medição. */
  @ViewChild('previewViewport') set previewViewport(ref: ElementRef<HTMLElement> | undefined) {
    this.viewportEl = ref?.nativeElement;
    this.observePreview();
  }

  @ViewChild('previewPage') set previewPage(ref: ElementRef<HTMLElement> | undefined) {
    this.pageEl = ref?.nativeElement;
    this.observePreview();
  }

  async ngOnInit() {
    try {
      const authUser = await waitForAuthUser();
      if (!authUser) throw new Error('sem sessão');
      this.user = await this.usersService.getUserById(authUser.uid);
      if (!this.user) throw new Error('perfil não encontrado');

      this.form = this.formFrom(this.user);
      this.savedSnapshot = this.snapshot();

      this.subs.push(
        this.productsService.getBySeller(authUser.uid).subscribe(products => {
          this.productCount = products.length;
          this.soldCount = products.reduce((total, p) => total + (p.soldCount || 0), 0);
          this.products = products.slice(0, 8);
        }),
        this.reviewsService.watchStore(authUser.uid).pipe(catchError(() => of([]))).subscribe(list => {
          const rated = list.filter(r => typeof r.rating === 'number');
          this.storeRating = rated.length
            ? {
                average: (rated.reduce((sum, r) => sum + r.rating, 0) / rated.length)
                  .toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
                count: rated.length,
              }
            : null;
        }),
        this.usersService.getSellerFollowerCount(authUser.uid).pipe(catchError(() => of(0))).subscribe(n => (this.followerCount = n)),
      );
    } catch (error) {
      console.error('Falha ao carregar a vitrine:', error);
      this.loadFailed = true;
    } finally {
      this.loading = false;
    }
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
    this.resizeObserver?.disconnect();
    clearTimeout(this.copiedTimer);
    Object.values(this.localPreview).forEach(url => url && URL.revokeObjectURL(url));
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent) {
    if (this.isDirty) event.preventDefault();
  }

  // ------------------------------------------------------------ estado

  get isDirty(): boolean {
    return !this.loading && !this.loadFailed && this.snapshot() !== this.savedSnapshot;
  }

  get hasErrors(): boolean {
    return !!(this.instagramError || this.whatsAppError);
  }

  get busyUploading(): boolean {
    return this.uploading.banner || this.uploading.photo;
  }

  get canSave(): boolean {
    return this.isDirty && !this.hasErrors && !this.saving && !this.busyUploading;
  }

  get displayName(): string {
    return this.form.shopName.trim() || this.user?.displayName || this.user?.username || 'Sua loja';
  }

  get initials(): string {
    const words = this.displayName.split(/\s+/).filter(w => w && !/^(d[aeo]s?|e|&)$/i.test(w));
    return words.slice(0, 2).map(w => w[0]).join('').toUpperCase() || 'VN';
  }

  get bannerSrc(): string {
    return this.localPreview.banner || this.form.shopBanner;
  }

  get photoSrc(): string {
    return this.localPreview.photo || this.form.photoURL;
  }

  get primaryColor(): string {
    return normalizeHex(this.form.shopPrimaryColor) || SHOP_COLOR_DEFAULT;
  }

  get onPrimaryColor(): string {
    return textOnShopColor(this.primaryColor);
  }

  get isCustomColor(): boolean {
    return !this.swatches.some(s => s.hex === this.primaryColor);
  }

  get publicPath(): string {
    return this.user ? `/seller-profile/${this.user.uid}` : '';
  }

  get publicUrl(): string {
    const origin = environment.production ? 'https://www.vineonsite.com.br' : location.origin;
    return origin + this.publicPath;
  }

  get publicUrlLabel(): string {
    return this.publicUrl.replace(/^https?:\/\/(www\.)?/, '');
  }

  /** O que ainda deixa a loja com cara de vazia, na ordem em que o cliente nota. */
  get missing(): string[] {
    const list: string[] = [];
    if (!this.bannerSrc) list.push('capa');
    if (!this.photoSrc) list.push('foto');
    if (!this.form.shopDescription.trim()) list.push('descrição');
    return list;
  }

  get instagramHandle(): string {
    return this.form.shopInstagram.replace(/^@/, '');
  }

  get whatsAppDigits(): string {
    return this.form.shopWhatsApp.replace(/\D/g, '');
  }

  get accountPhone(): string {
    return formatPhone((this.user?.phoneNumber || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, ''));
  }

  get memberSince(): string {
    const date = toDate(this.user?.createdAt);
    return date ? date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : '';
  }

  /** 2 × 2 no celular; duas fileiras de três no computador (coluna "Sobre" ao lado). */
  get previewProducts(): (Product | null)[] {
    const count = this.device === 'desktop' ? 6 : 4;
    const list: (Product | null)[] = this.products.slice(0, count);
    while (list.length < count) list.push(null);
    return list;
  }

  // ------------------------------------------------------------ prévia

  setDevice(device: Device) {
    this.device = device;
    // O tamanho muda com a troca de classe; mede no próximo quadro.
    requestAnimationFrame(() => this.measurePreview());
  }

  previewWidth(): number {
    return PREVIEW_WIDTH[this.device];
  }

  async scrollToPreview() {
    await this.content?.scrollToTop(300);
  }

  private observePreview() {
    this.resizeObserver?.disconnect();
    if (!this.viewportEl || !this.pageEl || typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => this.measurePreview());
    this.resizeObserver.observe(this.viewportEl);
    this.resizeObserver.observe(this.pageEl);
  }

  /**
   * A página da prévia é desenhada na largura real (390 ou 1180 px) e
   * reduzida com `scale`: proporções, quebras de linha e corte da capa ficam
   * idênticos aos da loja. A altura da janela acompanha a escala.
   */
  private measurePreview() {
    const viewport = this.viewportEl;
    const page = this.pageEl;
    if (!viewport || !page) return;
    const scale = viewport.clientWidth / PREVIEW_WIDTH[this.device];
    const visible = Math.min(page.offsetHeight, PREVIEW_MAX_HEIGHT[this.device]);
    viewport.style.setProperty('--pv-scale', String(scale));
    viewport.style.height = `${Math.round(visible * scale)}px`;
    viewport.classList.toggle('is-clipped', page.offsetHeight > PREVIEW_MAX_HEIGHT[this.device]);
  }

  // ------------------------------------------------------------ imagens

  async onImagePicked(kind: ShopMediaKind, event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !this.user) return;

    const problem = shopImageProblem(file);
    if (problem) {
      await this.showToast(problem, 'warning');
      return;
    }

    const modal = await this.modalCtrl.create({
      component: ImageFramerComponent,
      componentProps: { file, kind },
      cssClass: 'vn-framer-modal',
      backdropDismiss: false,
    });
    if (window.matchMedia('(min-width: 768px)').matches) {
      modal.style.setProperty('--width', kind === 'banner' ? 'min(880px, 94vw)' : '520px');
      modal.style.setProperty('--height', kind === 'banner' ? 'min(620px, 92vh)' : 'min(680px, 92vh)');
      modal.style.setProperty('--border-radius', '16px');
    }
    await modal.present();

    const { data, role } = await modal.onWillDismiss<FramedImage>();
    if (role !== 'confirm' || !data) return;
    await this.upload(kind, data);
  }

  private async upload(kind: ShopMediaKind, framed: FramedImage) {
    if (!this.user) return;
    const previous = this.localPreview[kind];
    this.localPreview[kind] = URL.createObjectURL(framed.blob);
    if (previous) URL.revokeObjectURL(previous);

    this.uploading[kind] = true;
    try {
      const file = new File([framed.blob], `${kind}.jpg`, { type: 'image/jpeg' });
      const url = kind === 'banner'
        ? await this.usersService.uploadShowcaseBanner(this.user.uid, file)
        : await this.usersService.uploadProfilePhoto(this.user.uid, file);
      if (kind === 'banner') this.form.shopBanner = url;
      else this.form.photoURL = url;
    } catch (error) {
      console.error('Falha ao enviar imagem da vitrine:', error);
      this.localPreview[kind] = null;
      await this.showToast(
        kind === 'banner' ? 'A capa não foi enviada. Confira a internet e tente de novo.' : 'A foto não foi enviada. Confira a internet e tente de novo.',
        'danger',
      );
    } finally {
      this.uploading[kind] = false;
    }
  }

  removeBanner() {
    if (this.localPreview.banner) URL.revokeObjectURL(this.localPreview.banner);
    this.localPreview.banner = null;
    this.form.shopBanner = '';
  }

  // ------------------------------------------------------------ cor e contato

  pickColor(hex: string) {
    this.form.shopPrimaryColor = hex;
  }

  onCustomColor(event: Event) {
    const hex = normalizeHex((event.target as HTMLInputElement).value);
    if (hex) this.form.shopPrimaryColor = hex;
  }

  onHexTyped(value: string) {
    const hex = normalizeHex(value);
    if (hex) this.form.shopPrimaryColor = hex;
  }

  /** Aceita "@loja", "loja" ou o link inteiro do perfil. */
  normalizeInstagram() {
    let value = this.form.shopInstagram.trim();
    const fromUrl = value.match(/instagram\.com\/([^/?#\s]+)/i);
    if (fromUrl) value = fromUrl[1];
    value = value.replace(/^@+/, '');
    this.form.shopInstagram = value ? '@' + value : '';
    this.instagramError = value && !INSTAGRAM_HANDLE.test(value)
      ? 'Use só letras, números, ponto e sublinhado (até 30).'
      : '';
  }

  onWhatsAppInput(value: string) {
    let digits = value.replace(/\D/g, '');
    if (digits.length > 11 && digits.startsWith('55')) digits = digits.slice(2);
    digits = digits.slice(0, 11);
    this.form.shopWhatsApp = formatPhone(digits);
    if (this.whatsAppError) this.validateWhatsApp();
  }

  validateWhatsApp() {
    const n = this.whatsAppDigits.length;
    this.whatsAppError = n && (n < 10 || n > 11) ? 'Número com DDD: 10 ou 11 dígitos.' : '';
  }

  useAccountPhone() {
    this.onWhatsAppInput(this.accountPhone);
    this.validateWhatsApp();
  }

  async copyLink() {
    try {
      await navigator.clipboard.writeText(this.publicUrl);
      this.linkCopied = true;
      clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => (this.linkCopied = false), 2200);
    } catch {
      await this.showToast('Não deu para copiar. Segure o link para copiar manualmente.', 'warning');
    }
  }

  // ------------------------------------------------------------ salvar e sair

  async save() {
    this.normalizeInstagram();
    this.validateWhatsApp();
    if (!this.user || !this.canSave) return;

    this.saving = true;
    const f = this.form;
    const payload: Partial<AppUser> = {
      shopName: f.shopName.trim(),
      shopDescription: f.shopDescription.trim(),
      shopFeaturedTitle: f.shopFeaturedTitle.trim(),
      shopBanner: f.shopBanner,
      shopPrimaryColor: this.primaryColor,
      shopInstagram: f.shopInstagram,
      shopWhatsApp: f.shopWhatsApp,
    };
    if (f.photoURL && f.photoURL !== (this.user.photoURL || '')) payload.photoURL = f.photoURL;

    try {
      await this.usersService.updateCurrentUserProfile(payload);
      this.user = { ...this.user, ...payload };
      this.form = { ...f, ...payload, photoURL: f.photoURL } as ShowcaseForm;
      this.savedSnapshot = this.snapshot();
      await this.showToast('Vitrine salva. Em instantes ela aparece assim na sua loja.', 'success');
    } catch (error) {
      console.error('Falha ao salvar a vitrine:', error);
      await this.showToast('Não deu para salvar. Confira a internet e tente de novo.', 'danger');
    } finally {
      this.saving = false;
    }
  }

  async goBack() {
    if (!this.isDirty) {
      this.navCtrl.back();
      return;
    }
    const alert = await this.alertCtrl.create({
      header: 'Sair sem salvar?',
      message: 'As mudanças na sua vitrine ainda não foram salvas.',
      buttons: [
        { text: 'Continuar editando', role: 'cancel' },
        { text: 'Sair sem salvar', role: 'destructive', handler: () => { this.savedSnapshot = this.snapshot(); this.navCtrl.back(); } },
      ],
    });
    await alert.present();
  }

  // ------------------------------------------------------------ apoio

  formatPrice(price: number): string {
    return (price || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  productImage(product: Product): string {
    return product.photoURL?.[0] || 'assets/imagens/imagem-placeholder.png';
  }

  private emptyForm(): ShowcaseForm {
    return {
      shopName: '', shopDescription: '', shopFeaturedTitle: '', shopBanner: '', photoURL: '',
      shopPrimaryColor: SHOP_COLOR_DEFAULT, shopInstagram: '', shopWhatsApp: '',
    };
  }

  private formFrom(user: AppUser): ShowcaseForm {
    const handle = (user.shopInstagram || '').trim().replace(/^@+/, '');
    return {
      shopName: user.shopName || user.displayName || '',
      shopDescription: user.shopDescription || '',
      shopFeaturedTitle: user.shopFeaturedTitle || '',
      shopBanner: user.shopBanner || '',
      photoURL: user.photoURL || '',
      shopPrimaryColor: normalizeHex(user.shopPrimaryColor) || SHOP_COLOR_DEFAULT,
      shopInstagram: handle ? '@' + handle : '',
      shopWhatsApp: user.shopWhatsApp || '',
    };
  }

  private snapshot(): string {
    return JSON.stringify(this.form);
  }

  private async showToast(message: string, color: 'success' | 'danger' | 'warning') {
    const toast = await this.toastCtrl.create({ message, color, duration: 2800, position: 'top' });
    await toast.present();
  }
}

/** (11) 98765-4321 enquanto digita. */
function formatPhone(digits: string): string {
  if (!digits) return '';
  if (digits.length <= 2) return `(${digits}`;
  const ddd = digits.slice(0, 2);
  const rest = digits.slice(2);
  const split = rest.length > 8 ? 5 : 4;
  return rest.length > split ? `(${ddd}) ${rest.slice(0, split)}-${rest.slice(split)}` : `(${ddd}) ${rest}`;
}
