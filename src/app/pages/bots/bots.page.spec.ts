import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BotsPage } from './bots.page';

describe('BotsPage', () => {
  let component: BotsPage;
  let fixture: ComponentFixture<BotsPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(BotsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
