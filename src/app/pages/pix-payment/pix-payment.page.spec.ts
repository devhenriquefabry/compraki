import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PixPaymentPage } from './pix-payment.page';

describe('PixPaymentPage', () => {
  let component: PixPaymentPage;
  let fixture: ComponentFixture<PixPaymentPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(PixPaymentPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
