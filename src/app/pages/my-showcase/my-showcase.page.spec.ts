import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MyShowcasePage } from './my-showcase.page';

describe('MyShowcasePage', () => {
  let component: MyShowcasePage;
  let fixture: ComponentFixture<MyShowcasePage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(MyShowcasePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
