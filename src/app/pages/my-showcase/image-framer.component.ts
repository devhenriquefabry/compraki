import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, Input, OnDestroy, OnInit, ViewChild, computed, inject, signal,
} from '@angular/core';
import { ModalController } from '@ionic/angular';

import {
  BANNER_MOBILE_SAFE, SHOP_MEDIA, ShopMediaKind, ShopMediaSpec, loadImage, renderCrop,
} from '../../core/shop-media';
import { SHOWCASE_ICONS } from './showcase-icons';

export interface FramedImage {
  blob: Blob;
  width: number;
  height: number;
}

const MAX_ZOOM = 3;

/**
 * Enquadramento da capa ou da foto antes do envio.
 *
 * A pessoa arrasta (ou usa as setas) e aproxima; o que está dentro da moldura
 * é gravado no tamanho do formato (`SHOP_MEDIA`). Assim a loja nunca recebe uma
 * capa esticada nem uma foto cortada pela metade, e quem escolheu sabe antes de
 * enviar o que vai aparecer no celular (faixa tracejada) e onde a foto da loja
 * cobre a capa.
 *
 * O estado é o ponto central do recorte em px da imagem original + o zoom:
 * sobrevive a redimensionar a janela sem pular.
 */
@Component({
  selector: 'app-image-framer',
  standalone: true,
  templateUrl: './image-framer.component.html',
  styleUrls: ['./image-framer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImageFramerComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input() file!: File;
  @Input() kind: ShopMediaKind = 'banner';

  @ViewChild('frame', { static: true }) frameRef!: ElementRef<HTMLDivElement>;

  private readonly modalCtrl = inject(ModalController);

  readonly ic = SHOWCASE_ICONS;
  readonly mobileSafe = BANNER_MOBILE_SAFE;
  spec: ShopMediaSpec = SHOP_MEDIA.banner;

  readonly src = signal('');
  readonly failed = signal(false);
  readonly busy = signal(false);

  private readonly natural = signal({ w: 0, h: 0 });
  private readonly frameW = signal(0);
  readonly zoom = signal(1);
  private readonly center = signal({ x: 0, y: 0 });

  private img: HTMLImageElement | null = null;
  private observer?: ResizeObserver;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchStart: { dist: number; zoom: number } | null = null;

  readonly ready = computed(() => this.natural().w > 0 && this.frameW() > 0);

  private readonly frameH = computed(() => this.frameW() * this.spec.height / this.spec.width);

  /** Escala tela/imagem: no zoom 1 a imagem cobre a moldura inteira. */
  private readonly scale = computed(() => {
    const { w, h } = this.natural();
    if (!w || !h || !this.frameW()) return 1;
    return Math.max(this.frameW() / w, this.frameH() / h) * this.zoom();
  });

  readonly imageStyle = computed(() => {
    const { w, h } = this.natural();
    const s = this.scale();
    const c = this.center();
    const left = this.frameW() / 2 - c.x * s;
    const top = this.frameH() / 2 - c.y * s;
    return {
      width: `${w * s}px`,
      height: `${h * s}px`,
      transform: `translate3d(${left}px, ${top}px, 0)`,
    };
  });

  /** Largura, em px da imagem original, do que vai ser gravado. */
  readonly sourceWidth = computed(() => Math.round(this.frameW() / this.scale()));

  readonly outputSize = computed(() => {
    const w = Math.min(this.spec.width, this.sourceWidth());
    return { w, h: Math.round(w * this.spec.height / this.spec.width) };
  });

  readonly quality = computed<'good' | 'ok' | 'low'>(() => {
    const w = this.sourceWidth();
    if (w >= this.spec.width) return 'good';
    return w >= this.spec.minWidth ? 'ok' : 'low';
  });

  ngOnInit() {
    this.spec = SHOP_MEDIA[this.kind];
    const url = URL.createObjectURL(this.file);
    this.src.set(url);
    loadImage(url)
      .then(img => {
        this.img = img;
        this.natural.set({ w: img.naturalWidth, h: img.naturalHeight });
        this.center.set({ x: img.naturalWidth / 2, y: img.naturalHeight / 2 });
      })
      .catch(() => this.failed.set(true));
  }

  ngAfterViewInit() {
    const frame = this.frameRef.nativeElement;
    this.observer = new ResizeObserver(() => {
      this.frameW.set(frame.clientWidth);
      this.clamp();
    });
    this.observer.observe(frame);
  }

  ngOnDestroy() {
    this.observer?.disconnect();
    if (this.src()) URL.revokeObjectURL(this.src());
  }

  // ------------------------------------------------------------ movimento

  onPointerDown(event: PointerEvent) {
    if (!this.ready()) return;
    this.frameRef.nativeElement.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 2) {
      this.pinchStart = { dist: this.pointerDistance(), zoom: this.zoom() };
    }
  }

  onPointerMove(event: PointerEvent) {
    const last = this.pointers.get(event.pointerId);
    if (!last) return;
    const next = { x: event.clientX, y: event.clientY };
    this.pointers.set(event.pointerId, next);

    if (this.pointers.size === 2 && this.pinchStart) {
      this.setZoom(this.pinchStart.zoom * this.pointerDistance() / this.pinchStart.dist);
      return;
    }
    this.moveBy(next.x - last.x, next.y - last.y);
  }

  onPointerUp(event: PointerEvent) {
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.pinchStart = null;
  }

  onWheel(event: WheelEvent) {
    if (!this.ready()) return;
    event.preventDefault();
    this.setZoom(this.zoom() * (event.deltaY < 0 ? 1.08 : 1 / 1.08));
  }

  onKeydown(event: KeyboardEvent) {
    const step = event.shiftKey ? 40 : 10;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step],
    };
    if (moves[event.key]) {
      event.preventDefault();
      this.moveBy(...moves[event.key]);
    } else if (event.key === '+' || event.key === '=') {
      this.setZoom(this.zoom() + 0.1);
    } else if (event.key === '-') {
      this.setZoom(this.zoom() - 0.1);
    }
  }

  onZoomInput(event: Event) {
    this.setZoom(Number((event.target as HTMLInputElement).value));
  }

  setZoom(value: number) {
    this.zoom.set(Math.min(MAX_ZOOM, Math.max(1, value)));
    this.clamp();
  }

  /** Arrastar a imagem para a direita mostra mais do lado esquerdo dela. */
  private moveBy(dx: number, dy: number) {
    const s = this.scale();
    const c = this.center();
    this.center.set({ x: c.x - dx / s, y: c.y - dy / s });
    this.clamp();
  }

  /** O recorte nunca sai da imagem: sem faixas vazias na moldura. */
  private clamp() {
    const { w, h } = this.natural();
    if (!w || !this.frameW()) return;
    const s = this.scale();
    const halfW = this.frameW() / s / 2;
    const halfH = this.frameH() / s / 2;
    const c = this.center();
    this.center.set({
      x: Math.min(w - halfW, Math.max(halfW, c.x)),
      y: Math.min(h - halfH, Math.max(halfH, c.y)),
    });
  }

  private pointerDistance(): number {
    const [a, b] = Array.from(this.pointers.values());
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  }

  // ------------------------------------------------------------ saída

  cancel() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  async confirm() {
    if (!this.img || !this.ready() || this.busy()) return;
    this.busy.set(true);
    try {
      const s = this.scale();
      const c = this.center();
      const width = this.frameW() / s;
      const height = this.frameH() / s;
      const blob = await renderCrop(this.img, { x: c.x - width / 2, y: c.y - height / 2, width, height }, this.spec);
      const out = this.outputSize();
      const result: FramedImage = { blob, width: out.w, height: out.h };
      await this.modalCtrl.dismiss(result, 'confirm');
    } catch {
      this.failed.set(true);
      this.busy.set(false);
    }
  }
}
