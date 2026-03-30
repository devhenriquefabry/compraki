import { TestBed } from '@angular/core/testing';

import { FirebaseProducts } from './firebase-products';

describe('FirebaseProducts', () => {
  let service: FirebaseProducts;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(FirebaseProducts);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
