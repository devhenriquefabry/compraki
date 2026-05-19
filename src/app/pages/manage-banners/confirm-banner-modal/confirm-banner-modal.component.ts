import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { Banner } from 'src/app/interfaces/banner';

@Component({
  selector: 'app-confirm-banner-modal',
  templateUrl: './confirm-banner-modal.component.html',
  styleUrls: ['./confirm-banner-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class ConfirmBannerModalComponent {
  @Input() currentBanner!: Banner;
  @Input() newBanner!: Partial<Banner>;

  public isSuccess: boolean = false;

  constructor(private modalController: ModalController) {}

  cancel() {
    this.modalController.dismiss(false);
  }

  confirm() {
    this.isSuccess = true;
    setTimeout(() => {
      this.modalController.dismiss(true);
    }, 2000);
  }
}
