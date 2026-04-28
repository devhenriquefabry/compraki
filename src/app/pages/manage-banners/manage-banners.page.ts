import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Subscription, Observable } from 'rxjs';
import { Banner } from '../../interfaces/banner';
import { BannerService } from '../../services/banner.service';

@Component({
  selector: 'app-manage-banners',
  templateUrl: './manage-banners.page.html',
  styleUrls: ['./manage-banners.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, DatePipe]
})
export class ManageBannersPage implements OnInit, OnDestroy {

  public banners$!: Observable<Banner[]>;
  public showSpecs = true;

  // Modal State
  public isFormOpen = false;
  public isSaving = false;
  public editingBanner: Banner | null = null;
  public previewImageUrl: string = '';
  private selectedFile: File | null = null;

  // Form Model
  public form: Partial<Banner> = this.getEmptyForm();

  constructor(private bannerService: BannerService) {}

  ngOnInit() {
    this.banners$ = this.bannerService.getAll();
  }

  ngOnDestroy() {}

  private getEmptyForm(): Partial<Banner> {
    return {
      title: '',
      subtitle: '',
      buttonText: '',
      buttonLink: '',
      imageURL: '',
      backgroundColor: '#4a9c2b',
      textColor: '#ffffff',
      status: 'active',
      scheduledStart: '',
      scheduledEnd: '',
      order: 1
    };
  }

  openForm(banner?: Banner) {
    this.editingBanner = banner || null;
    if (banner) {
      this.form = { ...banner };
      this.previewImageUrl = banner.imageURL || '';
    } else {
      this.form = this.getEmptyForm();
      this.previewImageUrl = '';
    }
    this.selectedFile = null;
    this.isFormOpen = true;
  }

  closeForm() {
    this.isFormOpen = false;
    this.editingBanner = null;
    this.form = this.getEmptyForm();
    this.previewImageUrl = '';
    this.selectedFile = null;
  }

  onFileSelected(event: any) {
    const file: File = event.target.files[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      alert('O arquivo deve ter no máximo 2MB!');
      return;
    }

    this.selectedFile = file;

    // Gera prévia local imediata
    const reader = new FileReader();
    reader.onload = (e: any) => {
      this.previewImageUrl = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  async saveBanner() {
    if (!this.form.title?.trim()) {
      alert('O título do banner é obrigatório!');
      return;
    }

    this.isSaving = true;
    try {
      let imageURL = this.form.imageURL || '';

      // Se houver um arquivo novo, faz upload primeiro
      if (this.selectedFile) {
        imageURL = await this.bannerService.uploadBannerImage(this.selectedFile);
      }

      const payload: Omit<Banner, 'id'> = {
        title: this.form.title || '',
        subtitle: this.form.subtitle || '',
        buttonText: this.form.buttonText || '',
        buttonLink: this.form.buttonLink || '',
        imageURL,
        backgroundColor: this.form.backgroundColor || '#4a9c2b',
        textColor: this.form.textColor || '#ffffff',
        status: this.form.status || 'active',
        scheduledStart: this.form.scheduledStart || '',
        scheduledEnd: this.form.scheduledEnd || '',
        order: Number(this.form.order) || 1,
      };

      if (this.editingBanner?.id) {
        await this.bannerService.update(this.editingBanner.id, payload);
      } else {
        await this.bannerService.create(payload);
      }

      this.closeForm();
    } catch (e) {
      console.error('Erro ao salvar banner:', e);
      alert('Erro ao salvar o banner. Verifique o console.');
    } finally {
      this.isSaving = false;
    }
  }

  async toggleStatus(banner: Banner) {
    if (!banner.id) return;
    const newStatus = banner.status === 'active' ? 'inactive' : 'active';
    await this.bannerService.update(banner.id, { status: newStatus });
  }

  async deleteBanner(banner: Banner) {
    if (!banner.id) return;
    const confirmed = confirm(`Deseja remover o banner "${banner.title}"?`);
    if (!confirmed) return;
    await this.bannerService.delete(banner.id);
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      active: 'Ativo',
      inactive: 'Inativo',
      scheduled: 'Agendado'
    };
    return labels[status] || status;
  }

  getStatusIcon(status: string): string {
    const icons: Record<string, string> = {
      active: 'checkmark-circle-outline',
      inactive: 'close-circle-outline',
      scheduled: 'calendar-outline'
    };
    return icons[status] || 'help-outline';
  }
}
