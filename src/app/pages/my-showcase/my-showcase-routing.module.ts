import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { MyShowcasePage } from './my-showcase.page';

const routes: Routes = [
  {
    path: '',
    component: MyShowcasePage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class MyShowcasePageRoutingModule {}
