import { NgIf } from '@angular/common';
import { Component, Input, input, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-custom-header',
  templateUrl: './custom-header.component.html',
  styleUrls: ['./custom-header.component.scss'],
  imports: [NgIf, RouterLink],
  standalone: true
})
export class CustomHeaderComponent  implements OnInit {
  @Input() backButton! : string
  @Input() titlePage! : string

  constructor() { }

  ngOnInit() {}

}
