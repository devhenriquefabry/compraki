import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';

import { AdminProductCardComponent } from './admin-product-card.component';

describe('AdminProductCardComponent', () => {
  let component: AdminProductCardComponent;
  let fixture: ComponentFixture<AdminProductCardComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [AdminProductCardComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminProductCardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
