import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';

import { AdminStatsGridComponent } from './admin-stats-grid.component';

describe('AdminStatsGridComponent', () => {
  let component: AdminStatsGridComponent;
  let fixture: ComponentFixture<AdminStatsGridComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [AdminStatsGridComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminStatsGridComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
