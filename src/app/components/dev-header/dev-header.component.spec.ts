import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';

import { DevHeaderComponent } from './dev-header.component';

describe('DevHeaderComponent', () => {
  let component: DevHeaderComponent;
  let fixture: ComponentFixture<DevHeaderComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [DevHeaderComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(DevHeaderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
