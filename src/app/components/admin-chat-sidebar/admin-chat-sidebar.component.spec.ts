import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';

import { AdminChatSidebarComponent } from './admin-chat-sidebar.component';

describe('AdminChatSidebarComponent', () => {
  let component: AdminChatSidebarComponent;
  let fixture: ComponentFixture<AdminChatSidebarComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [AdminChatSidebarComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminChatSidebarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
