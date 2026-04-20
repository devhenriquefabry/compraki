import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';

import { AdminFilterModalComponent } from './admin-filter-modal.component';

describe('AdminFilterModalComponent', () => {
  let component: AdminFilterModalComponent;
  let fixture: ComponentFixture<AdminFilterModalComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [AdminFilterModalComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminFilterModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
