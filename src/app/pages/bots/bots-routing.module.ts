import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { BotsPage } from './bots.page';

const routes: Routes = [
  {
    path: '',
    component: BotsPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class BotsPageRoutingModule {}
