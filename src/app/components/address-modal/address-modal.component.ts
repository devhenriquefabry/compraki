import { Component, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { IonicModule, ModalController, LoadingController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { closeOutline, saveOutline, locationOutline, homeOutline, briefcaseOutline } from 'ionicons/icons';
import { AddressService } from '../../services/address.service';

@Component({
  selector: 'app-address-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, IonicModule],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-title>{{ isEdit ? 'Editar Endereço' : 'Novo Endereço' }}</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="cancel()">
            <ion-icon name="close-outline"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding modal-content">
      <form [formGroup]="addressForm" (ngSubmit)="save()">
        
        <div class="form-section">
          <div class="section-label">Tipo de Endereço</div>
          <ion-radio-group formControlName="type" class="type-selector">
            <div class="type-option">
              <ion-radio value="Casa" labelPlacement="end">
                <div class="radio-label">
                  <ion-icon name="home-outline"></ion-icon>
                  Casa
                </div>
              </ion-radio>
            </div>
            <div class="type-option">
              <ion-radio value="Trabalho" labelPlacement="end">
                <div class="radio-label">
                  <ion-icon name="briefcase-outline"></ion-icon>
                  Trabalho
                </div>
              </ion-radio>
            </div>
          </ion-radio-group>
        </div>

        <div class="form-section">
          <div class="section-label">Informações de Entrega</div>
          
          <ion-item lines="none" class="custom-input">
            <ion-label position="stacked">CEP</ion-label>
            <ion-input formControlName="zipCode" placeholder="Ex: 01234-567" (ionInput)="onCepInput($event)" maxlength="9"></ion-input>
          </ion-item>

          <ion-item lines="none" class="custom-input">
            <ion-label position="stacked">Rua / Logradouro</ion-label>
            <ion-input formControlName="street" placeholder="Ex: Rua das Flores"></ion-input>
          </ion-item>

          <div class="row">
            <ion-item lines="none" class="custom-input col-4">
              <ion-label position="stacked">Número</ion-label>
              <ion-input formControlName="number" placeholder="Ex: 123"></ion-input>
            </ion-item>
            <ion-item lines="none" class="custom-input col-8">
              <ion-label position="stacked">Complemento</ion-label>
              <ion-input formControlName="complement" placeholder="Ex: Apto 101"></ion-input>
            </ion-item>
          </div>

          <ion-item lines="none" class="custom-input">
            <ion-label position="stacked">Bairro</ion-label>
            <ion-input formControlName="neighborhood" placeholder="Ex: Centro"></ion-input>
          </ion-item>

          <div class="row">
            <ion-item lines="none" class="custom-input col-8">
              <ion-label position="stacked">Cidade</ion-label>
              <ion-input formControlName="city" placeholder="Ex: São Paulo"></ion-input>
            </ion-item>
            <ion-item lines="none" class="custom-input col-4">
              <ion-label position="stacked">Estado</ion-label>
              <ion-input formControlName="state" placeholder="Ex: SP" maxlength="2"></ion-input>
            </ion-item>
          </div>
        </div>

        <div class="footer-actions">
          <ion-button expand="block" type="submit" [disabled]="!addressForm.valid" class="btn-save">
            <ion-icon name="save-outline" slot="start"></ion-icon>
            {{ isEdit ? 'Salvar Alterações' : 'Cadastrar Endereço' }}
          </ion-button>
        </div>
      </form>
    </ion-content>
  `,
  styles: [`
    ion-toolbar {
      --background: #ffffff;
      --color: #333;
      --border-style: none;
      padding: 8px 4px;
      
      ion-title {
        font-weight: 800;
        font-size: 18px;
      }
    }

    .modal-content {
      --background: #f8f9fa;
    }

    .form-section {
      margin-bottom: 24px;
      
      .section-label {
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        color: #888;
        letter-spacing: 1px;
        margin-bottom: 12px;
        padding-left: 4px;
      }
    }

    .type-selector {
      display: flex;
      gap: 12px;
      
      .type-option {
        flex: 1;
        background: #fff;
        border-radius: 12px;
        padding: 4px 12px;
        border: 1px solid #eee;

        ion-radio {
          --color: #ddd;
          --color-checked: #799d50;
          width: 100%;
          font-size: 14px;
          font-weight: 600;
          color: #333;
          
          .radio-label {
            display: flex;
            align-items: center;
            gap: 8px;
            ion-icon { font-size: 18px; }
          }
        }
      }
    }

    .custom-input {
      --background: #ffffff;
      --border-radius: 12px;
      margin-bottom: 12px;
      border: 1px solid #eee;
      box-shadow: 0 2px 8px rgba(0,0,0,0.02);
      
      ion-label {
        font-size: 11px;
        font-weight: 700;
        color: #799d50 !important;
        margin-bottom: 4px;
      }

      ion-input {
        --padding-top: 0;
        font-size: 15px;
        font-weight: 500;
      }
    }

    .row {
      display: flex;
      gap: 12px;
      
      .col-4 { flex: 4; }
      .col-8 { flex: 8; }
    }

    .footer-actions {
      margin-top: 32px;
      
      .btn-save {
        --background: #799d50;
        --border-radius: 14px;
        --box-shadow: 0 8px 20px rgba(121, 157, 80, 0.3);
        height: 54px;
        font-weight: 700;
        font-size: 15px;
      }
    }
  `]
})
export class AddressModalComponent implements OnInit {
  @Input() address: any;
  @Input() isEdit: boolean = false;

  private fb = inject(FormBuilder);
  private modalCtrl = inject(ModalController);
  private loadingCtrl = inject(LoadingController);
  private addressService = inject(AddressService);
  
  addressForm!: FormGroup;
  isLoadingCep: boolean = false;

  constructor() {
    addIcons({ closeOutline, saveOutline, locationOutline, homeOutline, briefcaseOutline });
  }

  ngOnInit() {
    this.initForm();
  }

  initForm() {
    this.addressForm = this.fb.group({
      id: [this.address?.id || ''],
      type: [this.address?.type || 'Casa', Validators.required],
      street: [this.address?.street || '', Validators.required],
      number: [this.address?.number || '', Validators.required],
      complement: [this.address?.complement || ''],
      neighborhood: [this.address?.neighborhood || '', Validators.required],
      city: [this.address?.city || '', Validators.required],
      state: [this.address?.state || '', [Validators.required, Validators.maxLength(2)]],
      zipCode: [this.address?.zipCode || '', Validators.required],
      isDefault: [this.address?.isDefault || false]
    });
  }

  cancel() {
    this.modalCtrl.dismiss();
  }

  save() {
    if (this.addressForm.valid) {
      this.modalCtrl.dismiss(this.addressForm.value);
    }
  }

  async onCepInput(event: any) {
    const value = event.target.value;
    const cep = value.replace(/\D/g, '');
    
    if (cep.length === 8) {
      const loading = await this.loadingCtrl.create({
        message: 'Buscando endereço...',
        spinner: 'crescent',
        cssClass: 'custom-loading'
      });
      await loading.present();

      this.isLoadingCep = true;
      try {
        const data = await this.addressService.getCEP(cep);
        this.addressForm.patchValue({
          street: data.logradouro,
          neighborhood: data.bairro,
          city: data.localidade,
          state: data.uf
        });
        
        // Formatar o CEP com hífen no input se não tiver
        if (!value.includes('-')) {
          this.addressForm.patchValue({
            zipCode: `${cep.substring(0, 5)}-${cep.substring(5)}`
          });
        }
      } catch (error) {
        console.error('Erro ao buscar CEP:', error);
      } finally {
        this.isLoadingCep = false;
        await loading.dismiss();
      }
    }
  }
}
