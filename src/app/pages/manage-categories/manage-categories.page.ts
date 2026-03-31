import { Component, OnInit, inject } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { AlertController, ModalController } from '@ionic/angular';
import { Category, Subcategory } from 'src/app/interfaces/category';
import { FirebaseCategories } from 'src/app/services/firebase-categories';
import { Observable } from 'rxjs';
import { IconSelectorModalComponent } from './icon-selector-modal/icon-selector-modal.component';

@Component({
  selector: 'app-manage-categories',
  templateUrl: './manage-categories.page.html',
  styleUrls: ['./manage-categories.page.scss'],
  standalone: false
})
export class ManageCategoriesPage implements OnInit {
  private fbCategories = inject(FirebaseCategories);
  private alertCtrl = inject(AlertController);
  private modalCtrl = inject(ModalController);
  
  public categories$!: Observable<Category[]>;
  public showAddCategory = false;
  
  public availableIcons: string[] = [
    'folder-outline', 'laptop-outline', 'shirt-outline', 'bed-outline', 'basketball-outline', 
    'car-outline', 'gift-outline', 'home-outline', 'game-controller-outline', 
    'nutrition-outline', 'paw-outline', 'build-outline', 'fast-food-outline', 
    'musical-notes-outline', 'camera-outline', 'phone-portrait-outline', 
    'watch-outline', 'glasses-outline', 'briefcase-outline', 'wallet-outline', 
    'cart-outline', 'storefront-outline', 'pricetags-outline', 'flower-outline', 
    'diamond-outline', 'headset-outline', 'brush-outline', 'color-palette-outline'
  ];
  public filteredIcons: string[] = [];
  public iconSearchTerm: string = '';

  categoryForm = new FormGroup({
    name: new FormControl('', [Validators.required]),
    icon: new FormControl('folder-outline'),
  });

  ngOnInit() {
    this.categories$ = this.fbCategories.getAll();
    this.filteredIcons = [...this.availableIcons];
  }

  filterIcons(event: any) {
    const term = event.target.value.toLowerCase();
    this.iconSearchTerm = term;
    this.filteredIcons = this.availableIcons.filter(icon => 
      icon.toLowerCase().includes(term)
    );
  }

  async addCategory() {
    if (this.categoryForm.valid) {
      const data = this.categoryForm.value as Partial<Category>;
      data.subcategories = [];
      await this.fbCategories.add(data);
      this.categoryForm.reset({ icon: 'folder-outline' });
      this.showAddCategory = false;
    }
  }

  async editCategory(category: Category, slidingItem: any) {
    if (slidingItem) slidingItem.close();
    
    const alert = await this.alertCtrl.create({
      header: 'Editar Categoria',
      message: 'Nome da categoria:',
      inputs: [
        { name: 'name', type: 'text', value: category.name, placeholder: 'Nome' }
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Escolher Ícone',
          handler: (data) => {
             this.openIconSelectorForUpdate(category.id, data.name || category.name);
             return true;
          }
        },
        {
          text: 'Salvar Nome',
          handler: async (data) => {
            if (data.name) {
              await this.fbCategories.update(category.id, {
                name: data.name
              });
            }
          }
        }
      ]
    });
    await alert.present();
  }

  async openIconSelector() {
    const modal = await this.modalCtrl.create({
      component: IconSelectorModalComponent,
      breakpoints: [0, 0.5, 0.8],
      initialBreakpoint: 0.5
    });
    await modal.present();
    const { data } = await modal.onDidDismiss();
    if (data) {
      this.categoryForm.patchValue({ icon: data });
    }
  }

  async openIconSelectorForUpdate(id: string, name: string) {
    const modal = await this.modalCtrl.create({
      component: IconSelectorModalComponent,
      breakpoints: [0, 0.5, 0.8],
      initialBreakpoint: 0.5
    });
    await modal.present();
    const { data } = await modal.onDidDismiss();
    if (data) {
      await this.fbCategories.update(id, { name, icon: data });
    }
  }

  async addSubcategory(category: Category) {
    const alert = await this.alertCtrl.create({
      header: 'Nova Subcategoria',
      inputs: [
        {
          name: 'name',
          type: 'text',
          placeholder: 'Nome da subcategoria'
        }
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Adicionar',
          handler: async (data) => {
            if (data.name) {
              const newSub: Subcategory = {
                id: Date.now().toString(),
                name: data.name
              };
              const subs = category.subcategories || [];
              await this.fbCategories.update(category.id, {
                subcategories: [...subs, newSub]
              });
            }
          }
        }
      ]
    });
    await alert.present();
  }

  async deleteCategory(id: string, slidingItem: any) {
    console.log('ID recebido para exclusão:', id);
    if (slidingItem) slidingItem.close();
    
    if (!id) {
      console.warn('ID da categoria está indefinido!');
      return;
    }

    const alert = await this.alertCtrl.create({
      header: 'Excluir Categoria?',
      message: 'Isso também removerá todas as subcategorias.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { 
          text: 'Excluir', 
          role: 'destructive',
          handler: async () => {
            try {
              console.log('Executando deleção no Firebase para o ID:', id);
              await this.fbCategories.delete(id);
              console.log('Deleção concluída com sucesso');
            } catch (err) {
              console.error('Erro ao excluir:', err);
            }
          }
        }
      ]
    });
    await alert.present();
  }

  async deleteSubcategory(category: Category, subId: string) {
    const alert = await this.alertCtrl.create({
      header: 'Remover Subcategoria?',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { 
          text: 'Remover', 
          role: 'destructive',
          handler: async () => {
            const subs = (category.subcategories || []).filter(s => s.id !== subId);
            await this.fbCategories.update(category.id, { subcategories: subs });
          }
        }
      ]
    });
    await alert.present();
  }

  async editSubcategory(category: Category, sub: Subcategory) {
    const alert = await this.alertCtrl.create({
      header: 'Editar Subcategoria',
      inputs: [
        { name: 'name', type: 'text', value: sub.name, placeholder: 'Nome' }
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Salvar',
          handler: async (data) => {
            if (data.name) {
              const subs = category.subcategories.map(s => 
                s.id === sub.id ? { ...s, name: data.name } : s
              );
              await this.fbCategories.update(category.id, { subcategories: subs });
            }
          }
        }
      ]
    });
    await alert.present();
  }
  trackCategory(index: number, cat: Category) {
    return cat.id;
  }

  trackSubcategory(index: number, sub: Subcategory) {
    return sub.id;
  }
}
