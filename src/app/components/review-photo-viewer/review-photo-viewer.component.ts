import { Component, HostListener, Input, OnInit, inject, signal } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { VnIconComponent } from '../vn-icon/vn-icon.component';

/**
 * Fotos de uma avaliação em tela cheia, com anterior/próxima (setas, teclado
 * e deslizar). Abrir com `ModalController` e `cssClass: 'vn-photo-viewer'`.
 *
 * `@Input()` comum, não signal input: o ModalController grava `componentProps`
 * direto na instância.
 */
@Component({
  selector: 'app-review-photo-viewer',
  standalone: true,
  imports: [VnIconComponent],
  template: `
    <div class="pv" (touchstart)="touchStart($event)" (touchend)="touchEnd($event)">
      <header class="pv-bar">
        <span class="pv-count">{{ index() + 1 }} de {{ urls.length }}</span>
        @if (caption) { <span class="pv-caption">{{ caption }}</span> }
        <button type="button" class="pv-btn" (click)="close()" aria-label="Fechar">
          <vn-icon name="close" />
        </button>
      </header>

      <div class="pv-stage">
        <img [src]="urls[index()]" [alt]="'Foto ' + (index() + 1) + ' da avaliação'" />
        @if (urls.length > 1) {
          <button type="button" class="pv-btn pv-nav pv-nav--prev" (click)="go(-1)" aria-label="Foto anterior">
            <vn-icon name="chevron" />
          </button>
          <button type="button" class="pv-btn pv-nav pv-nav--next" (click)="go(1)" aria-label="Próxima foto">
            <vn-icon name="chevron" />
          </button>
        }
      </div>

      @if (urls.length > 1) {
        <div class="pv-thumbs">
          @for (url of urls; track url; let i = $index) {
            <button type="button" class="pv-thumb" [class.is-active]="i === index()" (click)="index.set(i)"
                    [attr.aria-label]="'Ver foto ' + (i + 1)">
              <img [src]="url" alt="" />
            </button>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .pv {
      display: flex; flex-direction: column; height: 100%;
      background: #0B1623; color: #fff;
      font-family: var(--vn-font-body, 'Nunito', system-ui, sans-serif);
      padding-top: var(--ion-safe-area-top, 0);
      padding-bottom: var(--ion-safe-area-bottom, 0);
    }
    .pv-bar { display: flex; align-items: center; gap: 12px; height: 56px; padding: 0 8px 0 18px; }
    .pv-count { font-weight: 800; font-size: 14px; font-variant-numeric: tabular-nums; }
    .pv-caption { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                  font-size: 13.5px; color: rgba(255,255,255,.7); }
    .pv-count + .pv-btn { margin-left: auto; }
    .pv-btn {
      display: grid; place-items: center; width: 44px; height: 44px; border: 0; border-radius: 50%;
      background: transparent; color: #fff; font-size: 24px; cursor: pointer;
    }
    .pv-btn:hover { background: rgba(255,255,255,.1); }
    .pv-btn:focus-visible { outline: 2px solid #D8F51F; outline-offset: 2px; }
    .pv-stage { position: relative; flex: 1; min-height: 0; display: grid; place-items: center; padding: 8px; }
    .pv-stage img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 6px; }
    .pv-nav { position: absolute; top: 50%; transform: translateY(-50%); background: rgba(19,35,58,.85); }
    .pv-nav--prev { left: 12px; }
    .pv-nav--prev vn-icon { transform: rotate(180deg); }
    .pv-nav--next { right: 12px; }
    .pv-thumbs { display: flex; justify-content: center; gap: 8px; padding: 12px 16px 16px; overflow-x: auto; }
    .pv-thumb {
      flex: none; width: 52px; height: 52px; padding: 0; border: 0; border-radius: 8px; overflow: hidden;
      background: #13233A; opacity: .55; cursor: pointer; box-shadow: inset 0 0 0 2px transparent;
    }
    .pv-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .pv-thumb.is-active { opacity: 1; outline: 2px solid #D8F51F; outline-offset: 2px; }
    @media (max-width: 600px) { .pv-nav { display: none; } }
  `],
})
export class ReviewPhotoViewerComponent implements OnInit {
  @Input() urls: string[] = [];
  @Input() start = 0;
  @Input() caption = '';

  private readonly modalCtrl = inject(ModalController);
  readonly index = signal(0);
  private touchX: number | null = null;

  ngOnInit() {
    this.index.set(Math.max(0, Math.min(this.urls.length - 1, this.start)));
  }

  go(step: number) {
    const n = this.urls.length;
    if (n) this.index.set((this.index() + step + n) % n);
  }

  @HostListener('document:keydown', ['$event'])
  onKey(event: KeyboardEvent) {
    if (event.key === 'ArrowRight') this.go(1);
    else if (event.key === 'ArrowLeft') this.go(-1);
  }

  touchStart(event: TouchEvent) {
    this.touchX = event.touches[0]?.clientX ?? null;
  }

  touchEnd(event: TouchEvent) {
    const end = event.changedTouches[0]?.clientX;
    if (this.touchX === null || end === undefined) return;
    const dx = end - this.touchX;
    if (Math.abs(dx) > 50) this.go(dx < 0 ? 1 : -1);
    this.touchX = null;
  }

  close() {
    void this.modalCtrl.dismiss();
  }
}
