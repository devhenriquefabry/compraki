import { NgIf } from '@angular/common';
import { AfterContentInit, AfterViewInit, Component, OnInit } from '@angular/core';


@Component({
  selector: 'app-upload-product',
  templateUrl: './upload-product.page.html',
  styleUrls: ['./upload-product.page.scss'],
  standalone: false
})
export class UploadProductPage implements OnInit, AfterViewInit {

  public counter : number = 0
  constructor() { }

  ngOnInit() {
  }

  ngAfterViewInit(){
    setTimeout(()=>{

    this.counter = 1
    console.log(this.counter)
    }, 1000)

  }

}
