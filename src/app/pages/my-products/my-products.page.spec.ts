import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MyProductsPage } from './my-products.page';

describe('MyProductsPage', () => {
  let component: MyProductsPage;
  let fixture: ComponentFixture<MyProductsPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(MyProductsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
