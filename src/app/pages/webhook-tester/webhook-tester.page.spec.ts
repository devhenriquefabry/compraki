import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WebhookTesterPage } from './webhook-tester.page';

describe('WebhookTesterPage', () => {
  let component: WebhookTesterPage;
  let fixture: ComponentFixture<WebhookTesterPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(WebhookTesterPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
