import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MySalesPage } from './my-sales.page';

describe('MySalesPage', () => {
  let component: MySalesPage;
  let fixture: ComponentFixture<MySalesPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(MySalesPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
