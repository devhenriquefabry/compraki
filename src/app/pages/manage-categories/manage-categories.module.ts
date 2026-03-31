import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule, Routes } from '@angular/router';
import { ManageCategoriesPage } from './manage-categories.page';
import { ActionFooterComponent } from 'src/app/components/action-footer/action-footer.component';
import { MiniHeaderComponent } from 'src/app/components/mini-header/mini-header.component';

const routes: Routes = [
  {
    path: '',
    component: ManageCategoriesPage
  }
];

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    IonicModule,
    MiniHeaderComponent,
    ActionFooterComponent,
    RouterModule.forChild(routes)
  ],
  declarations: [ManageCategoriesPage]
})
export class ManageCategoriesPageModule {}
