import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DevProductsPage } from './dev-products.page';

describe('DevProductsPage', () => {
  let component: DevProductsPage;
  let fixture: ComponentFixture<DevProductsPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(DevProductsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
