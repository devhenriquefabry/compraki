
import { Component, OnInit, AfterViewInit } from '@angular/core';


@Component({
  selector: 'app-loading',
  templateUrl: './loading.component.html',
  styleUrls: ['./loading.component.scss'],
  standalone: true,
  imports: []
})
export class LoadingComponent implements OnInit {

  public counter: number = 1
  public show: boolean = true
  constructor() { }


  ngOnInit() {
    let interval = setInterval(() => {
      this.counter--
      if(this.counter <= 0 ){
        let container = document.getElementById('container') as unknown as HTMLElement
        container.classList.add('desaparecer')
        container.addEventListener('animationend', ()=>{
        clearInterval(interval)
        this.show = false
        })
      }
    }, 1000)

  }


}
