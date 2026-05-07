import { Component, OnInit, inject } from '@angular/core';
import { NavController, ToastController } from '@ionic/angular';
import { AppUser } from 'src/app/interfaces/app-user';
import { FirebaseProducts } from 'src/app/services/firebase-products';
import { FirebaseUsersService } from 'src/app/services/firebase-users.service';

@Component({
  selector: 'app-my-showcase',
  templateUrl: './my-showcase.page.html',
  styleUrls: ['./my-showcase.page.scss'],
  standalone: false
})
export class MyShowcasePage implements OnInit {

  public usuario: AppUser | null = null;
  public isSaving = false;
  public isUploadingBanner = false;
  
  public showcaseForm = {
    shopName: '',
    shopDescription: '',
    shopBanner: '',
    shopPrimaryColor: '#7c4dff',
    shopSecondaryColor: '#00e676',
    shopInstagram: '',
    shopWhatsApp: '',
    shopFeaturedTitle: 'Meus Destaques'
  };

  private firebaseService = inject(FirebaseProducts);
  private usersService = inject(FirebaseUsersService);
  private navCtrl = inject(NavController);
  private toastCtrl = inject(ToastController);

  constructor() { }

  async ngOnInit() {
    await this.loadUserData();
  }

  async loadUserData() {
    const currentUser = this.firebaseService.getUser();
    if (currentUser) {
      this.usuario = await this.usersService.getUserById(currentUser.uid);
      if (this.usuario) {
        this.showcaseForm = {
          shopName: this.usuario.shopName || this.usuario.displayName || '',
          shopDescription: this.usuario.shopDescription || '',
          shopBanner: this.usuario.shopBanner || '',
          shopPrimaryColor: this.usuario.shopPrimaryColor || '#7c4dff',
          shopSecondaryColor: this.usuario.shopSecondaryColor || '#00e676',
          shopInstagram: this.usuario.shopInstagram || '',
          shopWhatsApp: this.usuario.shopWhatsApp || this.usuario.phoneNumber || '',
          shopFeaturedTitle: this.usuario.shopFeaturedTitle || 'Meus Destaques'
        };
      }
    }
  }

  async onBannerSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !this.usuario) return;

    this.isUploadingBanner = true;
    try {
      const bannerUrl = await this.usersService.uploadShowcaseBanner(this.usuario.uid, file);
      this.showcaseForm.shopBanner = bannerUrl;
      await this.showToast('Banner carregado! Não esqueça de salvar.');
    } catch (error) {
      console.error(error);
      await this.showToast('Erro ao carregar banner.', 'danger');
    } finally {
      this.isUploadingBanner = false;
      input.value = '';
    }
  }

  async saveShowcase() {
    if (!this.usuario || this.isSaving) return;

    this.isSaving = true;
    try {
      await this.usersService.updateCurrentUserProfile({
        shopName: this.showcaseForm.shopName,
        shopDescription: this.showcaseForm.shopDescription,
        shopBanner: this.showcaseForm.shopBanner,
        shopPrimaryColor: this.showcaseForm.shopPrimaryColor,
        shopSecondaryColor: this.showcaseForm.shopSecondaryColor,
        shopInstagram: this.showcaseForm.shopInstagram,
        shopWhatsApp: this.showcaseForm.shopWhatsApp,
        shopFeaturedTitle: this.showcaseForm.shopFeaturedTitle
      });
      await this.showToast('Sua vitrine foi atualizada com sucesso!');
      this.navCtrl.back();
    } catch (error) {
      console.error(error);
      await this.showToast('Erro ao salvar as alterações.', 'danger');
    } finally {
      this.isSaving = false;
    }
  }

  async showToast(message: string, color: 'success' | 'danger' | 'warning' = 'success') {
    const toast = await this.toastCtrl.create({
      message,
      color,
      duration: 2500,
      position: 'top'
    });
    await toast.present();
  }

  goBack() {
    this.navCtrl.back();
  }
}
