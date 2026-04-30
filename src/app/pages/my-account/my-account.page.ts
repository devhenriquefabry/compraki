import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { User } from 'firebase/auth';
import { FirebaseProducts } from 'src/app/services/firebase-products';
import { NavController, ToastController } from '@ionic/angular';
import { AppUser } from 'src/app/interfaces/app-user';
import { FirebaseUsersService } from 'src/app/services/firebase-users.service';

@Component({
  selector: 'app-my-account',
  templateUrl: './my-account.page.html',
  styleUrls: ['./my-account.page.scss'],
  standalone: false
})
export class MyAccountPage implements OnInit, OnDestroy {

  public usuario!: User | null;
  public appUser: AppUser | null = null;
  public activeView: 'overview' | 'editProfile' = 'overview';
  public isSavingProfile = false;
  public isPasswordPanelOpen = false;
  public isChangingPassword = false;
  public profileForm = {
    displayName: '',
    username: '',
    email: '',
    phoneNumber: '',
    cpf: ''
  };
  public passwordForm = {
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  };
  public firebaseService = inject(FirebaseProducts);
  private usersService = inject(FirebaseUsersService);
  private navCtrl = inject(NavController);
  private toastCtrl = inject(ToastController);
  private userPoll?: ReturnType<typeof setInterval>;
  private loadedUid = '';

  constructor() { }

  ngOnInit() {
    this.syncCurrentUser();
    this.userPoll = setInterval(() => {
      this.syncCurrentUser();
    }, 1000);
  }

  ngOnDestroy() {
    if (this.userPoll) {
      clearInterval(this.userPoll);
    }
  }

  get profileCompletion(): number {
    const fields = [
      this.profileForm.displayName,
      this.profileForm.username,
      this.profileForm.email,
      this.profileForm.phoneNumber,
      this.profileForm.cpf
    ];
    const filledFields = fields.filter(value => value && value.trim()).length;
    return Math.round((filledFields / fields.length) * 100);
  }

  get profileCompletionWidth(): string {
    return `${this.profileCompletion}%`;
  }

  get currentPhotoUrl(): string {
    return this.usuario?.photoURL || this.appUser?.photoURL || 'assets/imagens/default-avatar.png';
  }

  private syncCurrentUser() {
    const previousUid = this.usuario?.uid || '';
    const currentUser = this.firebaseService.getUser();
    this.usuario = currentUser;

    if (currentUser && currentUser.uid !== this.loadedUid) {
      this.loadedUid = currentUser.uid;
      void this.loadProfileData(currentUser);
      return;
    }

    if (!currentUser && previousUid) {
      this.loadedUid = '';
      this.appUser = null;
      this.resetProfileForm();
    }
  }

  private async loadProfileData(user: User) {
    this.appUser = await this.usersService.getUserById(user.uid);
    this.profileForm = {
      displayName: this.appUser?.displayName || user.displayName || '',
      username: this.appUser?.username || this.buildDefaultUsername(user),
      email: this.appUser?.email || user.email || '',
      phoneNumber: this.appUser?.phoneNumber || user.phoneNumber || '',
      cpf: this.appUser?.cpf || ''
    };
  }

  private resetProfileForm() {
    this.profileForm = {
      displayName: '',
      username: '',
      email: '',
      phoneNumber: '',
      cpf: ''
    };
  }

  private buildDefaultUsername(user: User): string {
    const source = user.email?.split('@')[0] || user.displayName || '';
    return source
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]/g, '.')
      .toLowerCase();
  }

  async onProfilePhotoSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';

    if (!file || !this.usuario) return;

    this.isSavingProfile = true;
    try {
      const photoURL = await this.usersService.uploadProfilePhoto(this.usuario.uid, file);
      await this.usersService.updateCurrentUserProfile({ photoURL });
      await this.usuario.reload();
      this.usuario = this.firebaseService.getUser();
      await this.loadProfileData(this.usuario!);
      await this.showToast('Foto de perfil atualizada.');
    } catch (error) {
      console.error(error);
      await this.showToast('Não foi possível atualizar a foto.', 'danger');
    } finally {
      this.isSavingProfile = false;
    }
  }

  openProfileEditor() {
    this.activeView = 'editProfile';
  }

  closeProfileEditor() {
    this.activeView = 'overview';
  }

  async saveProfile() {
    if (!this.usuario || this.isSavingProfile) return;

    const displayName = this.profileForm.displayName.trim();
    if (!displayName) {
      await this.showToast('Informe seu nome completo.', 'warning');
      return;
    }

    this.isSavingProfile = true;
    try {
      await this.usersService.updateCurrentUserProfile({
        displayName,
        username: this.profileForm.username.trim() || null,
        phoneNumber: this.profileForm.phoneNumber.trim() || null,
        cpf: this.profileForm.cpf.trim() || null
      });

      await this.usuario.reload();
      this.usuario = this.firebaseService.getUser();
      await this.loadProfileData(this.usuario!);
      this.activeView = 'overview';
      await this.showToast('Cadastro atualizado com sucesso.');
    } catch (error) {
      console.error(error);
      await this.showToast('Não foi possível salvar seus dados.', 'danger');
    } finally {
      this.isSavingProfile = false;
    }
  }

  togglePasswordPanel() {
    this.isPasswordPanelOpen = !this.isPasswordPanelOpen;
  }

  async changePassword() {
    if (this.isChangingPassword) return;

    const currentPassword = this.passwordForm.currentPassword.trim();
    const newPassword = this.passwordForm.newPassword.trim();
    const confirmPassword = this.passwordForm.confirmPassword.trim();

    if (!currentPassword || !newPassword || !confirmPassword) {
      await this.showToast('Preencha a senha atual, a nova senha e a confirmação.', 'warning');
      return;
    }

    if (newPassword.length < 6) {
      await this.showToast('A nova senha precisa ter pelo menos 6 caracteres.', 'warning');
      return;
    }

    if (newPassword !== confirmPassword) {
      await this.showToast('A confirmação não confere com a nova senha.', 'warning');
      return;
    }

    this.isChangingPassword = true;
    try {
      await this.usersService.changeCurrentUserPassword(currentPassword, newPassword);
      this.passwordForm = {
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
      };
      this.isPasswordPanelOpen = false;
      await this.showToast('Senha alterada com sucesso.');
    } catch (error) {
      console.error(error);
      await this.showToast(this.getPasswordErrorMessage(error), 'danger');
    } finally {
      this.isChangingPassword = false;
    }
  }

  private getPasswordErrorMessage(error: unknown): string {
    const serializedError = JSON.stringify(error);
    if (serializedError.includes('auth/wrong-password') || serializedError.includes('auth/invalid-credential')) {
      return 'Senha atual incorreta.';
    }

    if (serializedError.includes('auth/weak-password')) {
      return 'A nova senha está fraca. Use pelo menos 6 caracteres.';
    }

    if (serializedError.includes('auth/requires-recent-login')) {
      return 'Por segurança, faça login novamente antes de alterar a senha.';
    }

    if (serializedError.includes('auth/operation-not-allowed')) {
      return 'Esta conta não usa senha. Tente acessar com o provedor usado no cadastro.';
    }

    return 'Não foi possível alterar a senha.';
  }

  private async showToast(message: string, color: 'success' | 'danger' | 'warning' = 'success') {
    const toast = await this.toastCtrl.create({
      message,
      color,
      duration: 2400,
      position: 'top'
    });
    await toast.present();
  }

  get memberSinceLabel(): string {
    const creationTime = this.usuario?.metadata?.creationTime;
    if (!creationTime) return 'Agora';

    const createdAt = new Date(creationTime);
    if (Number.isNaN(createdAt.getTime())) return 'Agora';

    return createdAt.toLocaleDateString('pt-BR', {
      month: 'long',
      year: 'numeric'
    });
  }

  goToCart() {
    this.navCtrl.navigateForward('/tabs/cart');
  }

  goToOrders() {
    this.navCtrl.navigateForward('/my-orders');
  }

  goToSaved() {
    this.navCtrl.navigateForward('/tabs/saved');
  }

  goToAddress() {
    this.navCtrl.navigateForward('/address');
  }

  goToPayments() {
    this.navCtrl.navigateForward('/payments');
  }

  goToNotifications() {
    this.navCtrl.navigateForward('/tabs/notifications');
  }

  goToMyProducts() {
    this.navCtrl.navigateForward('/my-products');
  }

  goToMySales() {
    this.navCtrl.navigateForward('/my-sales');
  }

  logout() {
    this.firebaseService.signOut();
  }

}
