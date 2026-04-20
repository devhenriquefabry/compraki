import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ManageChatsPage } from './manage-chats.page';

describe('ManageChatsPage', () => {
  let component: ManageChatsPage;
  let fixture: ComponentFixture<ManageChatsPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(ManageChatsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
